#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { SoWork } from 'sowork';
import { HELP, readSoworkCliConfig, readToolConfig, resolveConfig, updateToolConfig } from './config.ts';
import type { Availability, Member } from './presence.ts';
import { App, describeError } from './tui.ts';

const AVAILABILITIES: ReadonlySet<string> = new Set<Availability>(['available', 'busy', 'away', 'offline']);

function isAvailability(value: string): value is Availability {
  return AVAILABILITIES.has(value);
}

function version(): string {
  const pkg: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const value: unknown = typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, 'version') : undefined;
  return typeof value === 'string' ? value : 'unknown';
}

async function main(): Promise<void> {
  const result = resolveConfig(
    process.argv.slice(2),
    process.env,
    () => readSoworkCliConfig(process.env),
    () => readToolConfig(process.env),
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

  const client = new SoWork(config.apiKey, config.baseUrl === undefined ? {} : { baseURL: config.baseUrl });

  let selfId: string;
  try {
    selfId = (await client.me.getMe()).data.id;
  } catch (err) {
    process.stderr.write(`sowork-presence-watch: could not connect to SoWork: ${describeError(err)}\n`);
    process.exitCode = 1;
    return;
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

  new App({
    fetchMembers,
    selfId,
    intervalSeconds: config.intervalSeconds,
    alertCommand: config.alertCommand,
    alertCommandSource: config.alertCommandSource,
    saveAlertCommand: (alertCommand) => updateToolConfig(process.env, { alertCommand }),
    savedWatched: readToolConfig(process.env).watched ?? [],
    saveWatched: (watched) => updateToolConfig(process.env, { watched }),
    watch: config.watch,
  }).start();
}

await main();
