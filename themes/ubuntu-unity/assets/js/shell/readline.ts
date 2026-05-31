import type { TerminalIO } from "./terminal";
import { cursorLeft, cursorRight, eraseLine, RESET } from "./ansi";

// Matches a single complete terminal key escape (CSI, SS3, or a 2-char Fe/Alt
// sequence) and nothing after it. A paste that merely starts with ESC has
// trailing bytes and so fails the anchored match, falling through to the
// sanitizer instead of being dropped wholesale.
const UNHANDLED_KEY_ESC = /^\x1b(\[[0-9;?]*[A-Za-z~]|O[A-Za-z]|.)$/;

// Strip C0 control characters (and DEL) so pasted/echoed text cannot inject
// cursor moves, colors, or screen clears. ESC (\x1b) is the primary vector,
// but the whole C0 range is removed. Tab/newline are optionally preserved for
// command output (echo); the readline edit path keeps neither.
export function stripControls(
  s: string,
  opts: { keepTab?: boolean; keepNewline?: boolean } = {},
): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\t") { if (opts.keepTab) out += ch; continue; }
    if (ch === "\n") { if (opts.keepNewline) out += ch; continue; }
    if (code < 0x20 || code === 0x7f) continue;
    out += ch;
  }
  return out;
}

export interface CompletionContext {
  /** Tokens preceding the one under the cursor. */
  tokens: string[];
  /** The token currently being completed (may be empty). */
  current: string;
  /** Index of the current token; 0 is the command name. */
  index: number;
}

/** Returns candidate full-token replacements matching ctx.current. */
export type CompleteFn = (ctx: CompletionContext) => string[];

export interface ReadlineOptions {
  onLine: (line: string) => void;
  complete?: CompleteFn;
}

// Renderer-agnostic single-line editor. Owns the line buffer, cursor, and
// in-memory history; renders edits by writing ANSI through TerminalIO.
export class Readline {
  private buffer = "";
  private cursor = 0;
  private promptText = "";
  private readonly history: string[] = [];
  private histIndex = -1;
  private draft = "";

  constructor(
    private readonly term: TerminalIO,
    private readonly opts: ReadlineOptions,
  ) {
    this.term.onData((d) => { this.handle(d); });
  }

  setPrompt(p: string): void { this.promptText = p; }

  getHistory(): readonly string[] { return this.history; }

  /** Start a fresh input line: print the prompt, reset the buffer. */
  prompt(): void {
    this.buffer = "";
    this.cursor = 0;
    this.histIndex = -1;
    this.draft = "";
    this.term.write(this.promptText);
  }

  private handle(data: string): void {
    switch (data) {
      case "\r":
      case "\n": this.enter(); return;
      case "\x7f":
      case "\x08": this.backspace(); return;
      case "\x1b[D": this.moveLeft(); return;
      case "\x1b[C": this.moveRight(); return;
      case "\x1b[A":
      case "\x1bOA": this.historyPrev(); return;
      case "\x1b[B":
      case "\x1bOB": this.historyNext(); return;
      case "\x1b[H":
      case "\x1b[1~":
      case "\x1bOH":
      case "\x01": this.toHome(); return;
      case "\x1b[F":
      case "\x1b[4~":
      case "\x1bOF":
      case "\x05": this.toEnd(); return;
      case "\x03": this.abort(); return;
      case "\x0c": this.clearScreen(); return;
      case "\t": this.tab(); return;
      default: break;
    }
    // A lone, complete escape sequence is an unhandled special key (function
    // keys, Alt combos, shift-Tab); ignore it. Anything else -- including a
    // paste that merely starts with ESC -- is sanitized and inserted, so
    // pasted control sequences cannot corrupt the screen.
    if (UNHANDLED_KEY_ESC.test(data)) return;
    const clean = stripControls(data);
    if (clean) this.insert(clean);
  }

  private render(): void {
    this.term.write(`\r${eraseLine}${this.promptText}${this.buffer}${RESET}`);
    const tail = this.buffer.length - this.cursor;
    if (tail > 0) this.term.write(cursorLeft(tail));
  }

  private setBuffer(value: string): void {
    this.buffer = value;
    this.cursor = value.length;
    this.render();
  }

  private insert(text: string): void {
    this.buffer = this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
    this.cursor += text.length;
    this.render();
  }

  private backspace(): void {
    if (this.cursor === 0) return;
    this.buffer = this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
    this.cursor -= 1;
    this.render();
  }

  private moveLeft(): void {
    if (this.cursor === 0) return;
    this.cursor -= 1;
    this.term.write(cursorLeft(1));
  }

  private moveRight(): void {
    if (this.cursor >= this.buffer.length) return;
    this.cursor += 1;
    this.term.write(cursorRight(1));
  }

  private toHome(): void {
    if (this.cursor === 0) return;
    this.term.write(cursorLeft(this.cursor));
    this.cursor = 0;
  }

  private toEnd(): void {
    const tail = this.buffer.length - this.cursor;
    if (tail <= 0) return;
    this.term.write(cursorRight(tail));
    this.cursor = this.buffer.length;
  }

  private historyPrev(): void {
    if (this.history.length === 0) return;
    if (this.histIndex === -1) {
      this.draft = this.buffer;
      this.histIndex = this.history.length - 1;
    } else if (this.histIndex > 0) {
      this.histIndex -= 1;
    }
    this.setBuffer(this.history[this.histIndex] ?? "");
  }

  private historyNext(): void {
    if (this.histIndex === -1) return;
    if (this.histIndex < this.history.length - 1) {
      this.histIndex += 1;
      this.setBuffer(this.history[this.histIndex] ?? "");
    } else {
      this.histIndex = -1;
      this.setBuffer(this.draft);
    }
  }

  private enter(): void {
    const line = this.buffer;
    this.term.write("\r\n");
    if (line.trim() && this.history[this.history.length - 1] !== line) {
      this.history.push(line);
    }
    this.histIndex = -1;
    this.draft = "";
    this.opts.onLine(line);
  }

  private abort(): void {
    this.term.write("^C\r\n");
    this.buffer = "";
    this.cursor = 0;
    this.histIndex = -1;
    this.draft = "";
    this.term.write(this.promptText);
  }

  private clearScreen(): void {
    this.term.clear();
    this.render();
  }

  private tab(): void {
    if (!this.opts.complete) return;
    const before = this.buffer.slice(0, this.cursor);
    const parts = before.split(/\s+/);
    const startedToken = !before.endsWith(" ") || before.length === 0;
    const current = startedToken ? (parts[parts.length - 1] ?? "") : "";
    const tokens = (startedToken ? parts.slice(0, -1) : parts).filter(Boolean);
    const index = tokens.length;

    const candidates = this.opts.complete({ tokens, current, index });
    if (candidates.length === 0) return;

    if (candidates.length === 1) {
      this.applyCompletion(current, candidates[0] ?? "", true);
      return;
    }

    const prefix = commonPrefix(candidates);
    if (prefix.length > current.length) {
      this.applyCompletion(current, prefix, false);
      return;
    }

    // Ambiguous: list candidates, then redraw the prompt + buffer.
    this.term.write("\r\n");
    this.term.writeln(candidates.join("  "));
    this.term.write(this.promptText + this.buffer);
    const tail = this.buffer.length - this.cursor;
    if (tail > 0) this.term.write(cursorLeft(tail));
  }

  private applyCompletion(current: string, replacement: string, addSpace: boolean): void {
    const suffix = replacement.slice(current.length) + (addSpace ? " " : "");
    this.insert(suffix);
  }
}

function commonPrefix(items: string[]): string {
  if (items.length === 0) return "";
  let prefix = items[0] ?? "";
  for (const item of items.slice(1)) {
    while (!item.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  return prefix;
}
