import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

export const DEFAULT_INTERVAL_SECONDS = 30;
export const MIN_INTERVAL_SECONDS = 10;

export interface Config {
  apiKey: string;
  baseUrl: string | undefined;
  intervalSeconds: number;
  alertCommand: string | undefined;
  watch: string[];
}

export type ConfigResult =
  | { kind: 'config'; config: Config }
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'error'; message: string };

export const HELP = `Usage: presence-watch [options]

Watch your SoWork office from the terminal. Mark teammates with an alert,
and get notified when their presence changes. Alerts last while the
process runs.

Options:
  --api-key <key>          SoWork API key (default: $SOWORK_API_KEY, then the
                           key saved by \`sowork login\`)
  --base-url <url>         API base URL (default: $SOWORK_BASE_URL, then the
                           saved CLI config, then production)
  --interval <seconds>     Seconds between checks, ${MIN_INTERVAL_SECONDS} or more
                           (default: $PRESENCE_WATCH_INTERVAL, then ${DEFAULT_INTERVAL_SECONDS})
  --alert-command <cmd>    Shell command to run on each alert (default:
                           $PRESENCE_WATCH_ALERT_COMMAND, then a desktop
                           notification on macOS or a terminal bell)
  --watch <name-or-id>     Start with an alert on this teammate. Repeat for
                           more. Matches a user id or part of a name.
  -h, --help               Show this help
  -v, --version            Show the version

The alert command gets these environment variables:
  PRESENCE_WATCH_USER_ID, PRESENCE_WATCH_NAME, PRESENCE_WATCH_FROM,
  PRESENCE_WATCH_TO, PRESENCE_WATCH_MESSAGE

Example:
  presence-watch --watch Alex \\
    --alert-command 'say "$PRESENCE_WATCH_NAME is now $PRESENCE_WATCH_TO"'
`;

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
  let raw: string;
  try {
    raw = readFileSync(soworkCliConfigPath(env), 'utf8');
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) {
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
): ConfigResult {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
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
  const apiKey = nonEmpty(values['api-key']) ?? nonEmpty(env.SOWORK_API_KEY) ?? nonEmpty(saved.apiKey);
  if (apiKey === undefined) {
    return {
      kind: 'error',
      message:
        'No API key. Pass --api-key, set SOWORK_API_KEY, or run `sowork login`. ' +
        'Create a key in SoWork settings.',
    };
  }

  const rawInterval = nonEmpty(values.interval) ?? nonEmpty(env.PRESENCE_WATCH_INTERVAL);
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
      baseUrl: nonEmpty(values['base-url']) ?? nonEmpty(env.SOWORK_BASE_URL) ?? nonEmpty(saved.baseUrl),
      intervalSeconds,
      alertCommand: nonEmpty(values['alert-command']) ?? nonEmpty(env.PRESENCE_WATCH_ALERT_COMMAND),
      watch: values.watch ?? [],
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}
