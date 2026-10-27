import { emitKeypressEvents, type Key } from 'node:readline';
import { runAlert } from './alert.ts';
import { MIN_INTERVAL_SECONDS, type Config } from './config.ts';
import {
  changeMessage,
  matchMembers,
  presenceChanges,
  sortMembers,
  type Availability,
  type Member,
} from './presence.ts';

export interface AppOptions {
  fetchMembers: () => Promise<Member[]>;
  selfId: string;
  intervalSeconds: number;
  alertCommand: string | undefined;
  alertCommandSource: Config['alertCommandSource'];
  /** Saves the alert command (undefined = the default alert). Returns an error message on failure. */
  saveAlertCommand: (command: string | undefined) => string | undefined;
  /** User ids with an alert on from the last run. */
  savedWatched: string[];
  /** Saves the user ids with an alert on. Returns an error message on failure. */
  saveWatched: (ids: string[]) => string | undefined;
  /** --watch values, resolved to teammates after the first check. */
  watch: string[];
}

const LOG_LINES = 5;
const NAME_WIDTH = 30;
const useColor = process.env.NO_COLOR === undefined;
const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = paint('2');
const bold = paint('1');
const red = paint('31');
const inverse = paint('7');

const DOT: Record<Availability, string> = {
  available: paint('32')('●'),
  busy: paint('31')('●'),
  away: paint('33')('◐'),
  offline: dim('○'),
};

export class App {
  private members: Member[] = [];
  private selectedId: string | undefined;
  private readonly watched = new Set<string>();
  private pendingWatch: string[];
  private intervalSeconds: number;
  private nextCheckAt = 0;
  private lastCheckAt: Date | undefined;
  private checking = false;
  private error: string | undefined;
  private readonly log: string[] = [];
  private ticker: NodeJS.Timeout | undefined;
  private readonly options: AppOptions;
  private alertCommand: string | undefined;
  private alertCommandSource: Config['alertCommandSource'];
  /** The alert command being typed, while the editor is open. */
  private draft: string | undefined;
  private restoredLogged = false;

  constructor(options: AppOptions) {
    this.options = options;
    this.alertCommand = options.alertCommand;
    this.alertCommandSource = options.alertCommandSource;
    this.intervalSeconds = options.intervalSeconds;
    this.pendingWatch = [...options.watch];
    for (const id of options.savedWatched) {
      this.watched.add(id);
    }
  }

  start(): void {
    const { stdin, stdout } = process;
    stdout.write('\x1b[?1049h\x1b[?25l');
    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('keypress', (text: string | undefined, key: Key | undefined) => {
      if (this.draft === undefined) {
        this.onKey(key);
      } else {
        this.onEditKey(text, key);
      }
    });
    stdout.on('resize', () => this.render());
    process.on('SIGTERM', () => this.quit());
    this.ticker = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  quit(): void {
    if (this.ticker !== undefined) {
      clearInterval(this.ticker);
    }
    process.stdout.write('\x1b[?25h\x1b[?1049l');
    process.exit(0);
  }

  private tick(): void {
    if (!this.checking && Date.now() >= this.nextCheckAt) {
      void this.check();
    }
    this.render();
  }

  private async check(): Promise<void> {
    this.checking = true;
    this.render();
    try {
      const current = sortMembers(await this.options.fetchMembers());
      const changes = presenceChanges(this.members, current, this.watched);
      this.members = current;
      this.error = undefined;
      this.lastCheckAt = new Date();
      this.applyPendingWatch();
      if (this.selectedId === undefined || !current.some((m) => m.id === this.selectedId)) {
        this.selectedId = current[0]?.id;
      }
      for (const change of changes) {
        this.addLog(changeMessage(change));
        void runAlert(change, this.alertCommand).then((failure) => {
          if (failure !== undefined) {
            this.addLog(red(`Alert failed: ${failure}`));
          }
        });
      }
    } catch (err) {
      this.error = describeError(err);
    } finally {
      this.checking = false;
      this.nextCheckAt = Date.now() + this.intervalSeconds * 1000;
      this.render();
    }
  }

  private applyPendingWatch(): void {
    if (!this.restoredLogged) {
      this.restoredLogged = true;
      const restored = this.members.filter((m) => this.watched.has(m.id)).map((m) => m.name);
      if (restored.length > 0) {
        this.addLog(`Saved alerts on for ${restored.join(', ')}`);
      }
    }
    const before = this.watched.size;
    for (const query of this.pendingWatch) {
      const matches = matchMembers(this.members, query);
      if (matches.length === 0) {
        this.addLog(red(`--watch ${query}: no teammate matches`));
      }
      for (const member of matches) {
        this.watched.add(member.id);
        this.addLog(`Alert on for ${member.name} (${member.availability})`);
      }
    }
    this.pendingWatch = [];
    if (this.watched.size !== before) {
      this.saveWatched();
    }
  }

  private saveWatched(): void {
    const failure = this.options.saveWatched([...this.watched]);
    if (failure !== undefined) {
      this.addLog(red(`Could not save the alerts: ${failure}`));
    }
  }

  private onKey(key: Key | undefined): void {
    if (key === undefined) {
      return;
    }
    if (key.name === 'q' || (key.ctrl === true && key.name === 'c')) {
      this.quit();
      return;
    }
    switch (key.name) {
      case 'up':
      case 'k':
        this.moveSelection(-1);
        break;
      case 'down':
      case 'j':
        this.moveSelection(1);
        break;
      case 'space':
      case 'return':
        this.toggleWatch();
        break;
      case 'r':
        if (!this.checking) {
          void this.check();
        }
        break;
      case 'a':
        this.draft = this.alertCommand ?? '';
        break;
      case 't':
        this.testAlert();
        break;
      default:
        if (key.sequence === '+' || key.sequence === '=') {
          this.changeInterval(10);
        } else if (key.sequence === '-') {
          this.changeInterval(-10);
        }
    }
    this.render();
  }

  private onEditKey(text: string | undefined, key: Key | undefined): void {
    const draft = this.draft ?? '';
    if (key?.ctrl === true && key.name === 'c') {
      this.quit();
      return;
    }
    if (key?.name === 'escape') {
      this.draft = undefined;
    } else if (key?.name === 'return' || key?.name === 'enter') {
      this.draft = undefined;
      this.saveAlertCommand(draft.trim());
    } else if (key?.name === 'backspace') {
      this.draft = Array.from(draft).slice(0, -1).join('');
    } else if (key?.ctrl === true && key.name === 'u') {
      this.draft = '';
    } else if (text !== undefined && key?.ctrl !== true && key?.meta !== true && !/[\x00-\x1f\x7f]/.test(text)) {
      this.draft = draft + text;
    }
    this.render();
  }

  private saveAlertCommand(command: string): void {
    const value = command.length > 0 ? command : undefined;
    const failure = this.options.saveAlertCommand(value);
    if (failure !== undefined) {
      this.addLog(red(`Could not save the alert command: ${failure}`));
      return;
    }
    const overridden = this.alertCommandSource === 'flag' || this.alertCommandSource === 'env';
    this.alertCommand = value;
    this.alertCommandSource = value === undefined ? 'default' : 'saved';
    this.addLog(`Saved alert: ${describeAlert(value)}. Press t to test it.`);
    if (overridden) {
      this.addLog(dim('Next start, --alert-command or SOWORK_PRESENCE_WATCH_ALERT_COMMAND still wins over the saved one.'));
    }
  }

  /** Runs the alert once with a made-up change of the selected teammate. */
  private testAlert(): void {
    const member =
      this.members.find((m) => m.id === this.selectedId) ?? this.members.find((m) => m.id === this.options.selfId);
    if (member === undefined) {
      return;
    }
    const to: Availability = member.availability === 'available' ? 'away' : 'available';
    const change = { member, from: member.availability, to };
    this.addLog(`Test alert: ${changeMessage(change)}`);
    void runAlert(change, this.alertCommand).then((failure) => {
      this.addLog(failure === undefined ? 'Test alert ran.' : red(`Test alert failed: ${failure}`));
    });
  }

  private moveSelection(delta: number): void {
    const index = this.members.findIndex((m) => m.id === this.selectedId);
    const next = this.members[Math.min(Math.max(index + delta, 0), this.members.length - 1)];
    if (next !== undefined) {
      this.selectedId = next.id;
    }
  }

  private toggleWatch(): void {
    const member = this.members.find((m) => m.id === this.selectedId);
    if (member === undefined) {
      return;
    }
    if (this.watched.delete(member.id)) {
      this.addLog(`Alert off for ${member.name}`);
    } else {
      this.watched.add(member.id);
      this.addLog(`Alert on for ${member.name} (${member.availability})`);
    }
    this.saveWatched();
  }

  private changeInterval(deltaSeconds: number): void {
    const next = Math.max(MIN_INTERVAL_SECONDS, this.intervalSeconds + deltaSeconds);
    if (next === this.intervalSeconds) {
      return;
    }
    this.nextCheckAt += (next - this.intervalSeconds) * 1000;
    this.intervalSeconds = next;
  }

  private addLog(line: string): void {
    this.log.push(`${dim(timeOf(new Date()))} ${line}`);
    this.log.splice(0, this.log.length - LOG_LINES);
    this.render();
  }

  private render(): void {
    const rows = process.stdout.rows ?? 24;
    const columns = process.stdout.columns ?? 80;

    const status = this.checking
      ? 'checking…'
      : `next check in ${Math.max(0, Math.ceil((this.nextCheckAt - Date.now()) / 1000))}s`;
    const last = this.lastCheckAt === undefined ? 'never' : timeOf(this.lastCheckAt);
    const watchedCount = this.members.filter((m) => this.watched.has(m.id)).length;
    const header = [
      `${bold('SoWork office')}  ${dim(`every ${this.intervalSeconds}s · ${status} · last ${last}`)}`,
      dim(
        `${this.members.length} teammates · ${watchedCount} ${watchedCount === 1 ? 'alert' : 'alerts'} on · ` +
          `alert: ${describeAlert(this.alertCommand)}${SOURCE_NOTE[this.alertCommandSource]}`,
      ),
      this.error === undefined ? '' : red(`Check failed: ${this.error}`),
    ];
    const footer =
      this.draft === undefined
        ? [
            '',
            ...this.log,
            dim('↑↓ select · space alert on/off · t test alert · a alert command · +/- interval · r check now · q quit'),
          ]
        : [
            '',
            ...this.log,
            bold('Alert command') +
              dim(' — runs in sh -c with $SOWORK_PRESENCE_WATCH_NAME, _FROM, _TO, _MESSAGE, _USER_ID'),
            `> ${tail(this.draft, columns - 4)}${inverse(' ')}`,
            dim('enter save · esc cancel · ctrl+u clear · save it empty for the default alert'),
          ];

    const listHeight = Math.max(1, rows - header.length - footer.length);
    const selectedIndex = Math.max(0, this.members.findIndex((m) => m.id === this.selectedId));
    const first = Math.min(
      Math.max(0, selectedIndex - Math.floor(listHeight / 2)),
      Math.max(0, this.members.length - listHeight),
    );
    const list = this.members.slice(first, first + listHeight).map((member) => {
      const bell = this.watched.has(member.id) ? '🔔' : '  ';
      const you = member.id === this.options.selfId ? dim(' (you)') : '';
      const name = fit(member.name, NAME_WIDTH);
      const text = member.textStatus === undefined ? '' : dim(`  ${member.textStatus}`);
      const line = `${DOT[member.availability]} ${bell} ${name} ${member.availability.padEnd(9)}${you}${text}`;
      return member.id === this.selectedId ? inverse(line) : line;
    });

    const lines = [...header, ...list, ...Array<string>(listHeight - list.length).fill(''), ...footer];
    process.stdout.write(`\x1b[H\x1b[2J${lines.map((l) => clip(l, columns)).join('\n')}`);
  }
}

const SOURCE_NOTE: Record<Config['alertCommandSource'], string> = {
  flag: ' (from --alert-command)',
  env: ' (from SOWORK_PRESENCE_WATCH_ALERT_COMMAND)',
  saved: '',
  default: '',
};

function describeAlert(command: string | undefined): string {
  if (command !== undefined) {
    return command;
  }
  return process.platform === 'darwin' ? 'desktop notification' : 'terminal bell';
}

function timeOf(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

/** Terminal columns of one code point: emoji take 2, joiners and variation selectors 0. */
export function charWidth(char: string): number {
  if (/[‍︀-️\p{Mn}]/u.test(char)) {
    return 0;
  }
  return /\p{Extended_Pictographic}/u.test(char) && (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1;
}

function textWidth(text: string): number {
  let total = 0;
  for (const char of text) {
    total += charWidth(char);
  }
  return total;
}

/** Keeps the end of the text within the width, so the cursor stays visible while typing. */
function tail(text: string, width: number): string {
  if (textWidth(text) <= width) {
    return text;
  }
  const chars = Array.from(text);
  let out = '';
  let used = 1;
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const char = chars[i] ?? '';
    if (used + charWidth(char) > width) {
      break;
    }
    out = char + out;
    used += charWidth(char);
  }
  return `…${out}`;
}

/** Truncates or pads to a fixed number of terminal columns. */
export function fit(text: string, width: number): string {
  if (textWidth(text) <= width) {
    return text + ' '.repeat(width - textWidth(text));
  }
  let out = '';
  let used = 0;
  for (const char of text) {
    if (used + charWidth(char) > width - 1) {
      break;
    }
    out += char;
    used += charWidth(char);
  }
  return `${out}…${' '.repeat(width - 1 - used)}`;
}

/** Keeps a line from wrapping. ANSI codes do not count toward the width. */
function clip(line: string, columns: number): string {
  let visible = 0;
  let out = '';
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    if (part.startsWith('\x1b[')) {
      out += part;
      continue;
    }
    for (const char of part) {
      if (visible + charWidth(char) > columns - 1) {
        return `${out}\x1b[0m`;
      }
      out += char;
      visible += charWidth(char);
    }
  }
  return out;
}

export function describeError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const status: unknown = Reflect.get(Reflect.get(err, 'response') ?? {}, 'status');
    if (status === 401) {
      return 'the API key was rejected (401). Check the key.';
    }
    if (status === 429) {
      return 'rate limited (429). Try a longer --interval.';
    }
    if (typeof status === 'number') {
      return `HTTP ${status}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
