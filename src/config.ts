import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

export const DEFAULT_INTERVAL_SECONDS = 30;
export const MIN_INTERVAL_SECONDS = 10;

export interface Config {
  /** A key from --api-key or $SOWORK_API_KEY. Without one, the tool uses a saved profile. */
  apiKey: { key: string; source: 'flag' | 'env' } | undefined;
  /** --profile: open this profile and skip the profile picker. */
  profile: string | undefined;
  baseUrl: string | undefined;
  intervalSeconds: number;
  alertCommand: string | undefined;
  /** Where the alert command came from; a flag or env var wins over the saved one. */
  alertCommandSource: 'flag' | 'env' | 'saved' | 'default';
  watch: string[];
}

export type ConfigResult =
  | { kind: 'config'; config: Config }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

export const HELP = `Usage: sowork-presence-watch [options]

Watch your SoWork office from the terminal. Mark teammates with an alert,
and get notified when their presence changes. Alerts and the alert command
are saved for the next start, but alerts only fire while the tool runs.

Each profile holds one SoWork API key (one office) and its alerts. At start
you pick a profile or create one. An API key belongs to one office: create it
in SoWork, in Settings → SoWork API → API keys.

Options:
  --profile <name>         Open this profile and skip the picker. With
                           --api-key, create the profile or replace its key.
  --api-key <key>          Use this key (default: $SOWORK_API_KEY). Without
                           --profile, the run uses no profile and saves no
                           alerts.
  --base-url <url>         API base URL (default: $SOWORK_BASE_URL, then the
                           saved CLI config, then production)
  --interval <seconds>     Seconds between checks, ${MIN_INTERVAL_SECONDS} or more
                           (default: $SOWORK_PRESENCE_WATCH_INTERVAL, then ${DEFAULT_INTERVAL_SECONDS})
  --alert-command <cmd>    Shell command to run on each alert (default:
                           $SOWORK_PRESENCE_WATCH_ALERT_COMMAND, then the one
                           saved with the \`a\` key, then a desktop notification
                           on macOS or a terminal bell)
  --watch <name-or-id>     Turn on an alert for this teammate (saved, like the
                           space key). Repeat for more. Matches a user id or
                           part of a name.
  -h, --help               Show this help
  -v, --version            Show the version

The alert command gets these environment variables:
  SOWORK_PRESENCE_WATCH_USER_ID, SOWORK_PRESENCE_WATCH_NAME,
  SOWORK_PRESENCE_WATCH_FROM, SOWORK_PRESENCE_WATCH_TO,
  SOWORK_PRESENCE_WATCH_MESSAGE

Example:
  sowork-presence-watch --watch Alex \\
    --alert-command 'say "$SOWORK_PRESENCE_WATCH_NAME is now $SOWORK_PRESENCE_WATCH_TO"'
`;

export interface Profile {
  apiKey: string;
  /** The key's user name when the profile was created, to tell profiles apart. */
  userName: string | undefined;
  /** User ids with an alert on (🔔). */
  watched: string[];
}

export interface SavedToolConfig {
  alertCommand: string | undefined;
  /** The profile opened last, selected first in the picker. */
  lastProfile: string | undefined;
  profiles: Record<string, Profile>;
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** Returns why a new profile name is not valid, or undefined when it is. */
export function profileNameProblem(name: string, config: SavedToolConfig): string | undefined {
  if (!PROFILE_NAME.test(name)) {
    return 'Use 1-32 letters, digits, dots, dashes or underscores, starting with a letter or digit.';
  }
  if (Object.hasOwn(config.profiles, name)) {
    return `A profile named ${name} already exists.`;
  }
  return undefined;
}

/** Moves a profile to a new name. The last profile opened follows it. */
export function renameProfile(config: SavedToolConfig, from: string, to: string): void {
  const profile = config.profiles[from];
  if (profile === undefined) {
    return;
  }
  delete config.profiles[from];
  config.profiles[to] = profile;
  if (config.lastProfile === from) {
    config.lastProfile = to;
  }
}

/**
 * This tool's own settings file: $SOWORK_PRESENCE_WATCH_CONFIG_DIR, then
 * $XDG_CONFIG_HOME/sowork-presence-watch, then ~/.config/sowork-presence-watch.
 */
export function toolConfigPath(env: NodeJS.ProcessEnv): string {
  const override = nonEmpty(env.SOWORK_PRESENCE_WATCH_CONFIG_DIR);
  if (override !== undefined) {
    return path.join(override, 'config.json');
  }
  const base = nonEmpty(env.XDG_CONFIG_HOME) ?? path.join(homedir(), '.config');
  return path.join(base, 'sowork-presence-watch', 'config.json');
}

export function readToolConfig(env: NodeJS.ProcessEnv): SavedToolConfig {
  const parsed = readJsonObject(toolConfigPath(env));
  const profiles: Record<string, Profile> = {};
  const rawProfiles: unknown = parsed === undefined ? undefined : Reflect.get(parsed, 'profiles');
  if (typeof rawProfiles === 'object' && rawProfiles !== null) {
    for (const [name, raw] of Object.entries(rawProfiles)) {
      const profile = parseProfile(raw);
      if (PROFILE_NAME.test(name) && profile !== undefined) {
        profiles[name] = profile;
      }
    }
  }
  return {
    alertCommand: stringField(parsed, 'alertCommand'),
    lastProfile: stringField(parsed, 'lastProfile'),
    profiles,
  };
}

function parseProfile(raw: unknown): Profile | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const apiKey = stringField(raw, 'apiKey');
  if (apiKey === undefined) {
    return undefined;
  }
  const watched: unknown = Reflect.get(raw, 'watched');
  return {
    apiKey,
    userName: stringField(raw, 'userName'),
    watched: Array.isArray(watched) ? watched.filter((id): id is string => typeof id === 'string') : [],
  };
}

function stringField(value: object | undefined, field: string): string | undefined {
  const raw: unknown = value === undefined ? undefined : Reflect.get(value, field);
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * Reads the settings, applies a change and writes them back, so changes from
 * another running copy of the tool are kept. Returns an error message on
 * failure, else undefined.
 */
export function updateToolConfig(env: NodeJS.ProcessEnv, change: (config: SavedToolConfig) => void): string | undefined {
  const config = readToolConfig(env);
  change(config);
  return writeToolConfig(env, config);
}

/** Saves the settings file. Resolves with an error message on failure, else undefined. */
export function writeToolConfig(env: NodeJS.ProcessEnv, config: SavedToolConfig): string | undefined {
  const file = toolConfigPath(env);
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface SavedCliConfig {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Path of the config file that `sowork login` writes. Same precedence as the
 * sowork CLI: $SOWORK_CONFIG_DIR, then $XDG_CONFIG_HOME/sowork, then
 * ~/.config/sowork.
 */
export function soworkCliConfigPath(env: NodeJS.ProcessEnv): string {
  const override = nonEmpty(env.SOWORK_CONFIG_DIR);
  if (override !== undefined) {
    return path.join(override, 'config.json');
  }
  const base = nonEmpty(env.XDG_CONFIG_HOME) ?? path.join(homedir(), '.config');
  return path.join(base, 'sowork', 'config.json');
}

/** Reads the sowork CLI config. A missing or unreadable file means no saved config. */
export function readSoworkCliConfig(env: NodeJS.ProcessEnv): SavedCliConfig {
  const parsed = readJsonObject(soworkCliConfigPath(env));
  if (parsed === undefined) {
    return {};
  }
  const apiKey: unknown = Reflect.get(parsed, 'apiKey');
  const baseUrl: unknown = Reflect.get(parsed, 'baseUrl');
  return {
    apiKey: typeof apiKey === 'string' ? apiKey : undefined,
    baseUrl: typeof baseUrl === 'string' ? baseUrl : undefined,
  };
}

export function resolveConfig(
  argv: string[],
  env: NodeJS.ProcessEnv,
  savedConfig: () => SavedCliConfig,
  savedToolConfig: () => Pick<SavedToolConfig, 'alertCommand'> = () => ({ alertCommand: undefined }),
): ConfigResult {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        profile: { type: 'string' },
        'api-key': { type: 'string' },
        'base-url': { type: 'string' },
        interval: { type: 'string' },
        'alert-command': { type: 'string' },
        watch: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  if (values.help === true) {
    return { kind: 'help' };
  }
  if (values.version === true) {
    return { kind: 'version' };
  }

  const saved = savedConfig();
  const flagKey = nonEmpty(values['api-key']);
  const envKey = nonEmpty(env.SOWORK_API_KEY);
  let apiKey: Config['apiKey'];
  if (flagKey !== undefined) {
    apiKey = { key: flagKey, source: 'flag' };
  } else if (envKey !== undefined) {
    apiKey = { key: envKey, source: 'env' };
  }

  const rawInterval = nonEmpty(values.interval) ?? nonEmpty(env.SOWORK_PRESENCE_WATCH_INTERVAL);
  const intervalSeconds = rawInterval === undefined ? DEFAULT_INTERVAL_SECONDS : Number(rawInterval);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS) {
    return {
      kind: 'error',
      message: `--interval must be a whole number of seconds, ${MIN_INTERVAL_SECONDS} or more.`,
    };
  }

  return {
    kind: 'config',
    config: {
      apiKey,
      profile: nonEmpty(values.profile),
      baseUrl: nonEmpty(values['base-url']) ?? nonEmpty(env.SOWORK_BASE_URL) ?? nonEmpty(saved.baseUrl),
      intervalSeconds,
      ...resolveAlertCommand(values['alert-command'], env, savedToolConfig),
      watch: values.watch ?? [],
    },
  };
}

function resolveAlertCommand(
  flag: string | undefined,
  env: NodeJS.ProcessEnv,
  savedToolConfig: () => Pick<SavedToolConfig, 'alertCommand'>,
): Pick<Config, 'alertCommand' | 'alertCommandSource'> {
  const fromFlag = nonEmpty(flag);
  if (fromFlag !== undefined) {
    return { alertCommand: fromFlag, alertCommandSource: 'flag' };
  }
  const fromEnv = nonEmpty(env.SOWORK_PRESENCE_WATCH_ALERT_COMMAND);
  if (fromEnv !== undefined) {
    return { alertCommand: fromEnv, alertCommandSource: 'env' };
  }
  const saved = nonEmpty(savedToolConfig().alertCommand);
  if (saved !== undefined) {
    return { alertCommand: saved, alertCommandSource: 'saved' };
  }
  return { alertCommand: undefined, alertCommandSource: 'default' };
}

/** A missing, unreadable or non-object JSON file reads as undefined. */
function readJsonObject(file: string): object | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}
