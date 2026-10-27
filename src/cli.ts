#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { SoWork } from 'sowork';
import {
  HELP,
  readSoworkCliConfig,
  readToolConfig,
  renameProfile,
  resolveConfig,
  updateToolConfig,
  type Config,
  type Profile,
} from './config.ts';
import { OfficeView } from './office.ts';
import { ProfilePicker } from './picker.ts';
import type { Availability, Member } from './presence.ts';
import { describeError, terminal } from './ui.ts';

const AVAILABILITIES: ReadonlySet<string> = new Set<Availability>(['available', 'busy', 'away', 'offline']);

function isAvailability(value: string): value is Availability {
  return AVAILABILITIES.has(value);
}

function version(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const value: unknown = typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, 'version') : undefined;
  return typeof value === 'string' ? value : 'unknown';
}

/** What the office view opens with: a saved profile, or a key from a flag or env var. */
interface Session {
  profileName: string | undefined;
  apiKey: string;
  watched: string[];
}

const env = process.env;

function makeClient(config: Config, apiKey: string): SoWork {
  return new SoWork(apiKey, config.baseUrl === undefined ? {} : { baseURL: config.baseUrl });
}

async function userNameOf(config: Config, apiKey: string): Promise<string> {
  const { data } = await makeClient(config, apiKey).me.getMe();
  return data.name ?? data.id;
}

function saveProfile(name: string, profile: Profile): string | undefined {
  return updateToolConfig(env, (saved) => {
    saved.profiles[name] = profile;
    saved.lastProfile = name;
  });
}

/**
 * The session for the start: --api-key/$SOWORK_API_KEY with --profile saves
 * the key in that profile; a key alone runs without a profile; --profile
 * alone opens that profile. Anything else goes to the picker (undefined).
 */
async function startSession(config: Config): Promise<Session | undefined | { error: string }> {
  const name = config.profile;
  const saved = name === undefined ? undefined : readToolConfig(env).profiles[name];
  if (config.apiKey !== undefined && name !== undefined) {
    let userName: string;
    try {
      userName = await userNameOf(config, config.apiKey.key);
    } catch (err) {
      return { error: `the API key does not work: ${describeError(err)}` };
    }
    const failure = saveProfile(name, { apiKey: config.apiKey.key, userName, watched: saved?.watched ?? [] });
    if (failure !== undefined) {
      return { error: `could not save profile ${name}: ${failure}` };
    }
    return { profileName: name, apiKey: config.apiKey.key, watched: saved?.watched ?? [] };
  }
  if (config.apiKey !== undefined) {
    return { profileName: undefined, apiKey: config.apiKey.key, watched: [] };
  }
  if (name !== undefined && saved !== undefined) {
    saveProfile(name, saved);
    return { profileName: name, apiKey: saved.apiKey, watched: saved.watched };
  }
  return undefined;
}

async function pickSession(config: Config, notice: string | undefined): Promise<Session | undefined> {
  const savedProfiles = readToolConfig(env).profiles;
  const result = await new ProfilePicker({
    readConfig: () => readToolConfig(env),
    saveProfile,
    deleteProfile: (name) =>
      updateToolConfig(env, (saved) => {
        delete saved.profiles[name];
        if (saved.lastProfile === name) {
          saved.lastProfile = undefined;
        }
      }),
    renameProfile: (from, to) => updateToolConfig(env, (saved) => renameProfile(saved, from, to)),
    checkKey: (apiKey) => userNameOf(config, apiKey),
    soworkLoginKey: readSoworkCliConfig(env).apiKey,
    newProfileName:
      config.profile !== undefined && !Object.hasOwn(savedProfiles, config.profile) ? config.profile : undefined,
    notice,
  }).run();
  return result.kind === 'quit'
    ? undefined
    : { profileName: result.name, apiKey: result.profile.apiKey, watched: result.profile.watched };
}

/** Opens the office view for a session. Resolves with the exit, or an error when the key cannot connect. */
async function openOffice(
  config: Config,
  session: Session,
  watch: string[],
): Promise<'quit' | 'switch-profile' | { error: string }> {
  const client = makeClient(config, session.apiKey);
  let selfId: string;
  try {
    selfId = (await client.me.getMe()).data.id;
  } catch (err) {
    return { error: `could not connect to SoWork: ${describeError(err)}` };
  }

  const fetchMembers = async (): Promise<Member[]> => {
    const { data } = await client.users.listUsers();
    return data.users.map((user) => ({
      id: user.id,
      name: user.name ?? user.id,
      availability: isAvailability(user.presence.availability) ? user.presence.availability : 'offline',
      textStatus: user.presence.textStatus ?? undefined,
    }));
  };

  const { profileName } = session;
  return new OfficeView({
    profileName,
    fetchMembers,
    selfId,
    intervalSeconds: config.intervalSeconds,
    alertCommand: config.alertCommand,
    alertCommandSource: config.alertCommandSource,
    saveAlertCommand: (alertCommand) =>
      updateToolConfig(env, (saved) => {
        saved.alertCommand = alertCommand;
      }),
    savedWatched: session.watched,
    saveWatched:
      profileName === undefined
        ? undefined
        : (watched) =>
            updateToolConfig(env, (saved) => {
              const profile = saved.profiles[profileName];
              if (profile !== undefined) {
                profile.watched = watched;
              }
            }),
    watch,
  }).run();
}

async function main(): Promise<void> {
  const result = resolveConfig(
    process.argv.slice(2),
    env,
    () => readSoworkCliConfig(env),
    () => readToolConfig(env),
  );
  switch (result.kind) {
    case 'help':
      process.stdout.write(HELP);
      return;
    case 'version':
      process.stdout.write(`${version()}\n`);
      return;
    case 'error':
      process.stderr.write(`sowork-presence-watch: ${result.message}\n`);
      process.exitCode = 2;
      return;
  }
  const { config } = result;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('sowork-presence-watch: needs an interactive terminal.\n');
    process.exitCode = 2;
    return;
  }

  const start = await startSession(config);
  if (start !== undefined && 'error' in start) {
    process.stderr.write(`sowork-presence-watch: ${start.error}\n`);
    process.exitCode = 1;
    return;
  }

  terminal.enter();
  process.on('SIGTERM', () => {
    terminal.leave();
    process.exit(0);
  });
  try {
    let session = start;
    let notice: string | undefined;
    let watch = config.watch;
    for (;;) {
      session ??= await pickSession(config, notice);
      if (session === undefined) {
        return;
      }
      const exit = await openOffice(config, session, watch);
      watch = [];
      if (exit === 'quit') {
        return;
      }
      notice = exit === 'switch-profile' ? undefined : `${session.profileName ?? 'The key'}: ${exit.error}`;
      session = undefined;
    }
  } finally {
    terminal.leave();
  }
}

await main();
process.exit(process.exitCode ?? 0);
