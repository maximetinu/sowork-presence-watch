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
import {
  bold,
  describeError,
  dim,
  editLine,
  fit,
  inverse,
  isQuitKey,
  paint,
  red,
  tail,
  terminal,
  timeOf,
  type Key,
} from './ui.ts';

export interface AppOptions {
  /** The open profile, or undefined for a run with a key from --api-key or $SOWORK_API_KEY. */
  profileName: string | undefined;
  fetchMembers: () => Promise<Member[]>;
  selfId: string;
  intervalSeconds: number;
  alertCommand: string | undefined;
  alertCommandSource: Config['alertCommandSource'];
  /** Saves the alert command (undefined = the default alert). Returns an error message on failure. */
  saveAlertCommand: (command: string | undefined) => string | undefined;
  /** User ids with an alert on from the last run. */
  savedWatched: string[];
  /** Saves the user ids with an alert on. Returns an error message on failure. Undefined without a profile. */
  saveWatched: ((ids: string[]) => string | undefined) | undefined;
  /** --watch values, resolved to teammates after the first check. */
  watch: string[];
}

export type OfficeExit = 'quit' | 'switch-profile';

const LOG_LINES = 5;
const NAME_WIDTH = 30;

const DOT: Record<Availability, string> = {
  available: paint('32')('●'),
  busy: paint('31')('●'),
  away: paint('33')('◐'),
  offline: dim('○'),
};

/** The office view: the teammate list, alerts and the alert command editor. */
export class OfficeView {
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
  private stopListening: (() => void) | undefined;
  private finish: ((exit: OfficeExit) => void) | undefined;

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

  /** Shows the view until the user quits or asks to switch profile. */
  run(): Promise<OfficeExit> {
    return new Promise((resolve) => {
      this.finish = resolve;
      this.stopListening = terminal.listen(
        (text, key) => (this.draft === undefined ? this.onKey(key) : this.onEditKey(text, key)),
        () => this.render(),
      );
      this.ticker = setInterval(() => this.tick(), 1000);
      if (this.options.saveWatched === undefined) {
        this.addLog(dim('No profile: alerts are not saved. Press p to pick or create a profile.'));
      }
      this.tick();
    });
  }

  private exit(exit: OfficeExit): void {
    clearInterval(this.ticker);
    this.stopListening?.();
    this.finish?.(exit);
    this.finish = undefined;
  }

  private tick(): void {
    if (!this.checking && Date.now() >= this.nextCheckAt) {
      void this.check();
    }
    this.render();
  }

  private async check(): Promise<void> {
    if (this.finish === undefined) {
      return;
    }
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
    const failure = this.options.saveWatched?.([...this.watched]);
    if (failure !== undefined) {
      this.addLog(red(`Could not save the alerts: ${failure}`));
    }
  }

  private onKey(key: Key | undefined): void {
    if (key === undefined) {
      return;
    }
    if (key.name === 'q' || isQuitKey(key)) {
      this.exit('quit');
      return;
    }
    if (key.name === 'p') {
      this.exit('switch-profile');
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
    if (isQuitKey(key)) {
      this.exit('quit');
      return;
    }
    const edit = editLine(this.draft ?? '', text, key);
    if (edit.kind === 'edit') {
      this.draft = edit.value;
    } else {
      this.draft = undefined;
      if (edit.kind === 'submit') {
        this.saveAlertCommand(edit.value.trim());
      }
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
    if (this.finish === undefined) {
      return;
    }
    const rows = terminal.rows;
    const columns = terminal.columns;

    const status = this.checking
      ? 'checking…'
      : `next check in ${Math.max(0, Math.ceil((this.nextCheckAt - Date.now()) / 1000))}s`;
    const last = this.lastCheckAt === undefined ? 'never' : timeOf(this.lastCheckAt);
    const watchedCount = this.members.filter((m) => this.watched.has(m.id)).length;
    const header = [
      `${bold('SoWork office')} ${this.options.profileName === undefined ? dim('(no profile)') : bold(this.options.profileName)}  ` +
        dim(`every ${this.intervalSeconds}s · ${status} · last ${last}`),
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
            dim('↑↓ select · space alert on/off · t test alert · a alert command · +/- interval · r check now · p profiles · q quit'),
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

    terminal.draw([...header, ...list, ...Array<string>(listHeight - list.length).fill(''), ...footer]);
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
