import { spawn } from 'node:child_process';
import { changeMessage, type PresenceChange } from './presence.ts';

/**
 * Runs the alert for one change. With a custom command, it runs in `sh -c`
 * and gets the change in environment variables (never spliced into the
 * command text, so names with quotes are safe). Without one, it shows a macOS
 * notification, or rings the terminal bell on other systems.
 *
 * Resolves with an error message when the alert failed, else undefined.
 */
export function runAlert(change: PresenceChange, alertCommand: string | undefined): Promise<string | undefined> {
  const message = changeMessage(change);
  if (alertCommand !== undefined) {
    return run('sh', ['-c', alertCommand], {
      SOWORK_PRESENCE_WATCH_USER_ID: change.member.id,
      SOWORK_PRESENCE_WATCH_NAME: change.member.name,
      SOWORK_PRESENCE_WATCH_FROM: change.from,
      SOWORK_PRESENCE_WATCH_TO: change.to,
      SOWORK_PRESENCE_WATCH_MESSAGE: message,
    });
  }
  if (process.platform === 'darwin') {
    return run('osascript', [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 1 of argv) with title "SoWork" sound name "Glass"',
      '-e',
      'end run',
      message,
    ]);
  }
  process.stdout.write('\x07');
  return Promise.resolve(undefined);
}

function run(command: string, args: string[], extraEnv: Record<string, string> = {}): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => resolve(`${command}: ${err.message}`));
    child.on('close', (code) => {
      resolve(code === 0 ? undefined : `alert exited with code ${code}: ${stderr.trim().slice(0, 200)}`);
    });
  });
}
