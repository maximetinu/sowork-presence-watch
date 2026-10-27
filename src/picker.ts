import { profileNameProblem, type Profile, type SavedToolConfig } from './config.ts';
import {
  bold,
  describeError,
  dim,
  editLine,
  fit,
  green,
  inverse,
  isQuitKey,
  maskSecret,
  red,
  tail,
  terminal,
  type Key,
} from './ui.ts';

export interface PickerOptions {
  readConfig: () => SavedToolConfig;
  /** Saves a new or changed profile and makes it the last one opened. Returns an error message on failure. */
  saveProfile: (name: string, profile: Profile) => string | undefined;
  deleteProfile: (name: string) => string | undefined;
  /** Checks a key against the API and returns its user's name. Throws when the key does not work. */
  checkKey: (apiKey: string) => Promise<string>;
  /** The key saved by `sowork login`, offered when creating a profile. */
  soworkLoginKey: string | undefined;
  /** Start creating a profile with this name (from --profile with an unknown name). */
  newProfileName: string | undefined;
  /** A message to show at the top, for example why the last profile could not open. */
  notice: string | undefined;
}

export type PickResult = { kind: 'profile'; name: string; profile: Profile } | { kind: 'quit' };

type Mode = 'list' | 'name' | 'key' | 'checking' | 'confirm-delete';

const NEW_PROFILE = '+ New profile';

/** The start screen: pick a saved profile, create one, or delete one. */
export class ProfilePicker {
  private readonly options: PickerOptions;
  private config: SavedToolConfig;
  private mode: Mode = 'list';
  private selected = 0;
  private input = '';
  private newName = '';
  private message: string | undefined;
  private stopListening: (() => void) | undefined;
  private finish: ((result: PickResult) => void) | undefined;

  constructor(options: PickerOptions) {
    this.options = options;
    this.config = options.readConfig();
    this.message = options.notice === undefined ? undefined : red(options.notice);
    const last = this.names().indexOf(this.config.lastProfile ?? '');
    this.selected = Math.max(0, last);
    if (options.newProfileName !== undefined) {
      this.newName = options.newProfileName;
      this.mode = 'key';
    } else if (this.names().length === 0) {
      this.mode = 'name';
    }
  }

  run(): Promise<PickResult> {
    return new Promise((resolve) => {
      this.finish = resolve;
      this.stopListening = terminal.listen(
        (text, key) => this.onKey(text, key),
        () => this.render(),
      );
      this.render();
    });
  }

  private done(result: PickResult): void {
    this.stopListening?.();
    this.finish?.(result);
    this.finish = undefined;
  }

  private names(): string[] {
    return Object.keys(this.config.profiles).sort((a, b) => a.localeCompare(b));
  }

  private onKey(text: string | undefined, key: Key | undefined): void {
    if (isQuitKey(key)) {
      this.done({ kind: 'quit' });
      return;
    }
    switch (this.mode) {
      case 'list':
        this.onListKey(key);
        break;
      case 'name':
        this.onNameKey(text, key);
        break;
      case 'key':
        this.onApiKeyKey(text, key);
        break;
      case 'confirm-delete':
        this.onConfirmDeleteKey(key);
        break;
      case 'checking':
        return;
    }
    this.render();
  }

  private onListKey(key: Key | undefined): void {
    const names = this.names();
    switch (key?.name) {
      case 'up':
      case 'k':
        this.selected = Math.max(0, this.selected - 1);
        break;
      case 'down':
      case 'j':
        this.selected = Math.min(names.length, this.selected + 1);
        break;
      case 'return':
      case 'enter': {
        const name = names[this.selected];
        const profile = name === undefined ? undefined : this.config.profiles[name];
        if (name !== undefined && profile !== undefined) {
          const failure = this.options.saveProfile(name, profile);
          if (failure !== undefined) {
            this.message = red(`Could not save the settings: ${failure}`);
            return;
          }
          this.done({ kind: 'profile', name, profile });
        } else {
          this.startNewProfile();
        }
        break;
      }
      case 'n':
        this.startNewProfile();
        break;
      case 'd':
        if (names[this.selected] !== undefined) {
          this.mode = 'confirm-delete';
          this.message = undefined;
        }
        break;
      case 'q':
        this.done({ kind: 'quit' });
        break;
    }
  }

  private startNewProfile(): void {
    this.mode = 'name';
    this.input = '';
    this.message = undefined;
  }

  private onNameKey(text: string | undefined, key: Key | undefined): void {
    const edit = editLine(this.input, text, key);
    if (edit.kind === 'cancel') {
      this.mode = 'list';
      this.message = undefined;
    } else if (edit.kind === 'edit') {
      this.input = edit.value;
    } else {
      const name = edit.value.trim();
      const problem = profileNameProblem(name, this.config);
      if (problem !== undefined) {
        this.message = red(problem);
        return;
      }
      this.newName = name;
      this.input = '';
      this.message = undefined;
      this.mode = 'key';
    }
  }

  private onApiKeyKey(text: string | undefined, key: Key | undefined): void {
    const edit = editLine(this.input, text, key);
    if (edit.kind === 'cancel') {
      this.message = undefined;
      const fromFlag = this.options.newProfileName !== undefined;
      this.mode = fromFlag ? 'list' : 'name';
      this.input = fromFlag ? '' : this.newName;
    } else if (edit.kind === 'edit') {
      this.input = edit.value;
    } else {
      const apiKey = edit.value.trim() || this.options.soworkLoginKey;
      if (apiKey === undefined) {
        this.message = red('Paste an API key.');
        return;
      }
      void this.saveNewProfile(apiKey);
    }
  }

  private async saveNewProfile(apiKey: string): Promise<void> {
    this.mode = 'checking';
    this.message = undefined;
    this.render();
    let userName: string;
    try {
      userName = await this.options.checkKey(apiKey);
    } catch (err) {
      this.mode = 'key';
      this.message = red(`That key does not work: ${describeError(err)}`);
      this.render();
      return;
    }
    const profile: Profile = { apiKey, userName, watched: [] };
    const failure = this.options.saveProfile(this.newName, profile);
    if (failure !== undefined) {
      this.mode = 'key';
      this.message = red(`Could not save the profile: ${failure}`);
      this.render();
      return;
    }
    this.done({ kind: 'profile', name: this.newName, profile });
  }

  private onConfirmDeleteKey(key: Key | undefined): void {
    const name = this.names()[this.selected];
    if (key?.name === 'y' && name !== undefined) {
      const failure = this.options.deleteProfile(name);
      this.config = this.options.readConfig();
      this.selected = Math.min(this.selected, this.names().length);
      this.message = failure === undefined ? `Deleted profile ${name}.` : red(`Could not delete: ${failure}`);
    }
    this.mode = 'list';
  }

  private render(): void {
    if (this.finish === undefined) {
      return;
    }
    const columns = terminal.columns;
    const lines = [bold('sowork-presence-watch'), ''];

    if (this.mode === 'list' || this.mode === 'confirm-delete') {
      lines.push('Choose a profile. Each profile is one SoWork API key, so one office, with its own alerts.', '');
      const names = this.names();
      names.forEach((name, index) => {
        const profile = this.config.profiles[name];
        const alerts = profile?.watched.length ?? 0;
        const detail = dim(`${profile?.userName ?? ''} · ${alerts} ${alerts === 1 ? 'alert' : 'alerts'}`);
        const line = `${fit(name, 20)} ${detail}`;
        lines.push(index === this.selected ? inverse(`▸ ${line}`) : `  ${line}`);
      });
      lines.push(this.selected === names.length ? inverse(`▸ ${NEW_PROFILE}`) : `  ${NEW_PROFILE}`, '');
      if (this.message !== undefined) {
        lines.push(this.message, '');
      }
      lines.push(
        this.mode === 'confirm-delete'
          ? bold(`Delete profile ${names[this.selected] ?? ''} and its saved key? y yes · any other key no`)
          : dim('↑↓ select · enter open · n new profile · d delete · q quit'),
      );
    } else if (this.mode === 'name') {
      lines.push(bold('New profile'), 'A profile holds one SoWork API key, so one office, and its alerts.', '');
      lines.push(`Name: ${tail(this.input, columns - 10)}${inverse(' ')}`, '');
      if (this.message !== undefined) {
        lines.push(this.message, '');
      }
      lines.push(dim(`enter next · esc ${this.names().length === 0 ? 'cancel' : 'back'} · ctrl+c quit`));
    } else {
      lines.push(
        bold(`New profile ${this.newName}`),
        'Paste a SoWork API key. Create one in SoWork: Settings → SoWork API → API keys.',
        dim('A key belongs to the office that was open when you created it.'),
      );
      if (this.options.soworkLoginKey !== undefined) {
        lines.push(dim('Leave it empty to use the key saved by `sowork login`.'));
      }
      lines.push('');
      if (this.mode === 'checking') {
        lines.push(green('Checking the key…'));
      } else {
        lines.push(`Key: ${tail(maskSecret(this.input), columns - 10)}${inverse(' ')}`, '');
        if (this.message !== undefined) {
          lines.push(this.message, '');
        }
        lines.push(dim('enter check and save · esc back · ctrl+u clear · ctrl+c quit'));
      }
    }
    terminal.draw(lines);
  }
}
