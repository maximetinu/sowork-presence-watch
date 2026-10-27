import { emitKeypressEvents, type Key } from 'node:readline';

export type { Key };
export type KeyHandler = (text: string | undefined, key: Key | undefined) => void;

const useColor = process.env.NO_COLOR === undefined;
export const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
export const dim = paint('2');
export const bold = paint('1');
export const red = paint('31');
export const green = paint('32');
export const inverse = paint('7');

/** The full-screen terminal: one key handler at a time, so each screen owns the keyboard while it shows. */
export const terminal = {
  enter(): void {
    process.stdout.write('\x1b[?1049h\x1b[?25l');
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
  },

  leave(): void {
    process.stdout.write('\x1b[?25h\x1b[?1049l');
    process.stdin.setRawMode(false);
    process.stdin.pause();
  },

  /** Listens to keys and resizes until the returned function is called. */
  listen(onKey: KeyHandler, onResize: () => void): () => void {
    process.stdin.on('keypress', onKey);
    process.stdout.on('resize', onResize);
    return () => {
      process.stdin.off('keypress', onKey);
      process.stdout.off('resize', onResize);
    };
  },

  get rows(): number {
    return process.stdout.rows ?? 24;
  },

  get columns(): number {
    return process.stdout.columns ?? 80;
  },

  draw(lines: string[]): void {
    const columns = this.columns;
    process.stdout.write(`\x1b[H\x1b[2J${lines.map((l) => clip(l, columns)).join('\n')}`);
  },
};

export function isQuitKey(key: Key | undefined): boolean {
  return key?.ctrl === true && key.name === 'c';
}

export type LineEdit = { kind: 'edit'; value: string } | { kind: 'submit'; value: string } | { kind: 'cancel' };

/** Applies one key to a one-line text input. */
export function editLine(value: string, text: string | undefined, key: Key | undefined): LineEdit {
  if (key?.name === 'escape') {
    return { kind: 'cancel' };
  }
  if (key?.name === 'return' || key?.name === 'enter') {
    return { kind: 'submit', value };
  }
  if (key?.name === 'backspace') {
    return { kind: 'edit', value: Array.from(value).slice(0, -1).join('') };
  }
  if (key?.ctrl === true && key.name === 'u') {
    return { kind: 'edit', value: '' };
  }
  if (text !== undefined && key?.ctrl !== true && key?.meta !== true && !/[\x00-\x1f\x7f]/.test(text)) {
    return { kind: 'edit', value: value + text };
  }
  return { kind: 'edit', value };
}

/** Shows a secret as dots, with only its last 4 characters. */
export function maskSecret(secret: string): string {
  const chars = Array.from(secret);
  const visible = chars.length > 8 ? chars.slice(-4).join('') : '';
  return '•'.repeat(chars.length - visible.length) + visible;
}

export function timeOf(date: Date): string {
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
export function tail(text: string, width: number): string {
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
