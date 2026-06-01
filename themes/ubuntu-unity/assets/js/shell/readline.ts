import type { TerminalIO } from "./terminal";
import { cursorLeft, cursorRight, eraseLine, RESET } from "./ansi";

// Matches a single complete terminal key escape (CSI, SS3, or a 2-char Fe/Alt
// sequence) and nothing after it. A paste that merely starts with ESC has
// trailing bytes and so fails the anchored match, falling through to the
// sanitizer instead of being dropped wholesale.
const UNHANDLED_KEY_ESC = /^\x1b(\[[0-9;?]*[A-Za-z~]|O[A-Za-z]|.)$/;

const WORD = /[A-Za-z0-9]/;
const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch);
const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);

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
  /** Ctrl-D on an empty line. */
  onEof?: () => void;
  /** History to seed (e.g. restored from a previous session). */
  history?: string[];
  /** Called after each accepted line so the host can persist history. */
  onHistoryChange?: (history: readonly string[]) => void;
}

// Renderer-agnostic single-line editor. Owns the line buffer, cursor, kill
// ring, and history; renders edits by writing ANSI through TerminalIO.
export class Readline {
  private buffer = "";
  private cursor = 0;
  private promptText = "";
  private readonly history: string[] = [];
  private histIndex = -1;
  private draft = "";
  private kill = "";

  // Reverse-incremental-search (Ctrl-R) sub-mode state.
  private searching = false;
  private searchQuery = "";
  private searchIndex = -1;
  private savedBuffer = "";
  private savedCursor = 0;

  constructor(
    private readonly term: TerminalIO,
    private readonly opts: ReadlineOptions,
  ) {
    if (opts.history) this.history.push(...opts.history);
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
    this.searching = false;
    this.term.write(this.promptText);
  }

  private handle(data: string): void {
    if (this.searching) { this.handleSearch(data); return; }
    switch (data) {
      case "\r":
      case "\n": this.enter(); return;
      case "\x7f":
      case "\x08": this.backspace(); return;
      case "\x04": this.deleteForward(); return;
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
      case "\x1bb":
      case "\x1b[1;5D":
      case "\x1b[1;3D": this.wordLeft(); return;
      case "\x1bf":
      case "\x1b[1;5C":
      case "\x1b[1;3C": this.wordRight(); return;
      case "\x1bd": this.killWordForward(); return;
      case "\x17":
      case "\x1b\x7f": this.killWordBack(); return;
      case "\x15": this.killToStart(); return;
      case "\x0b": this.killToEnd(); return;
      case "\x19": this.yank(); return;
      case "\x12": this.startSearch(); return;
      case "\x03": this.abort(); return;
      case "\x0c": this.clearScreen(); return;
      case "\t": this.tab(); return;
      default: break;
    }
    // A lone, complete escape sequence is an unhandled special key (function
    // keys, unmapped Alt combos); ignore it. Anything else -- including a paste
    // that merely starts with ESC -- is sanitized and inserted, so pasted
    // control sequences cannot corrupt the screen.
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

  private deleteForward(): void {
    if (this.buffer.length === 0) { this.opts.onEof?.(); return; }
    if (this.cursor >= this.buffer.length) return;
    this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
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

  // Index of the start of the word at/just left of the cursor (alnum runs).
  private wordLeftIndex(): number {
    let i = this.cursor;
    while (i > 0 && !isWord(this.buffer[i - 1])) i -= 1;
    while (i > 0 && isWord(this.buffer[i - 1])) i -= 1;
    return i;
  }

  // Index just past the word at/just right of the cursor (alnum runs).
  private wordRightIndex(): number {
    const n = this.buffer.length;
    let i = this.cursor;
    while (i < n && !isWord(this.buffer[i])) i += 1;
    while (i < n && isWord(this.buffer[i])) i += 1;
    return i;
  }

  private wordLeft(): void {
    const i = this.wordLeftIndex();
    if (i === this.cursor) return;
    this.term.write(cursorLeft(this.cursor - i));
    this.cursor = i;
  }

  private wordRight(): void {
    const i = this.wordRightIndex();
    if (i === this.cursor) return;
    this.term.write(cursorRight(i - this.cursor));
    this.cursor = i;
  }

  // Ctrl-W: kill the whitespace-delimited word before the cursor.
  private killWordBack(): void {
    if (this.cursor === 0) return;
    let i = this.cursor;
    while (i > 0 && isSpace(this.buffer[i - 1])) i -= 1;
    while (i > 0 && !isSpace(this.buffer[i - 1])) i -= 1;
    this.kill = this.buffer.slice(i, this.cursor);
    this.buffer = this.buffer.slice(0, i) + this.buffer.slice(this.cursor);
    this.cursor = i;
    this.render();
  }

  // Alt-D: kill the word after the cursor.
  private killWordForward(): void {
    const i = this.wordRightIndex();
    if (i === this.cursor) return;
    this.kill = this.buffer.slice(this.cursor, i);
    this.buffer = this.buffer.slice(0, this.cursor) + this.buffer.slice(i);
    this.render();
  }

  private killToStart(): void {
    if (this.cursor === 0) return;
    this.kill = this.buffer.slice(0, this.cursor);
    this.buffer = this.buffer.slice(this.cursor);
    this.cursor = 0;
    this.render();
  }

  private killToEnd(): void {
    if (this.cursor >= this.buffer.length) return;
    this.kill = this.buffer.slice(this.cursor);
    this.buffer = this.buffer.slice(0, this.cursor);
    this.render();
  }

  private yank(): void {
    if (this.kill) this.insert(this.kill);
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
      this.opts.onHistoryChange?.(this.history);
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

  // --- Reverse incremental search (Ctrl-R) -------------------------------

  private startSearch(): void {
    this.searching = true;
    this.searchQuery = "";
    this.searchIndex = -1;
    this.savedBuffer = this.buffer;
    this.savedCursor = this.cursor;
    this.renderSearch();
  }

  private searchFrom(start: number): number {
    const q = this.searchQuery.toLowerCase();
    if (!q) return -1;
    for (let i = Math.min(start, this.history.length - 1); i >= 0; i -= 1) {
      if ((this.history[i] ?? "").toLowerCase().includes(q)) return i;
    }
    return -1;
  }

  private renderSearch(): void {
    const failed = this.searchIndex < 0 && this.searchQuery ? "failed " : "";
    const match = this.searchIndex >= 0 ? (this.history[this.searchIndex] ?? "") : "";
    this.term.write(`\r${eraseLine}(${failed}reverse-i-search)\`${this.searchQuery}': ${match}`);
  }

  // Leave search mode, adopting the current match (or the saved buffer if none)
  // as the line, and redraw the normal prompt.
  private acceptSearch(): void {
    const match = this.searchIndex >= 0 ? (this.history[this.searchIndex] ?? "") : this.savedBuffer;
    this.searching = false;
    this.searchQuery = "";
    this.searchIndex = -1;
    this.buffer = match;
    this.cursor = match.length;
    this.render();
  }

  private cancelSearch(): void {
    this.searching = false;
    this.searchQuery = "";
    this.searchIndex = -1;
    this.buffer = this.savedBuffer;
    this.cursor = this.savedCursor;
    this.render();
  }

  private handleSearch(data: string): void {
    if (data === "\x12") { // Ctrl-R: step to an older match
      const from = this.searchIndex >= 0 ? this.searchIndex - 1 : this.history.length - 1;
      const idx = this.searchFrom(from);
      if (idx >= 0) this.searchIndex = idx;
      this.renderSearch();
      return;
    }
    if (data === "\r" || data === "\n") { this.acceptSearch(); this.enter(); return; }
    if (data === "\x07" || data === "\x03") { this.cancelSearch(); return; }
    if (data === "\x7f" || data === "\x08") {
      this.searchQuery = this.searchQuery.slice(0, -1);
      this.searchIndex = this.searchFrom(this.history.length - 1);
      this.renderSearch();
      return;
    }
    // Any escape sequence (arrows, etc.) accepts the match, then re-dispatches.
    if (data.startsWith("\x1b")) { this.acceptSearch(); this.handle(data); return; }
    const clean = stripControls(data);
    if (!clean) { this.acceptSearch(); return; }
    this.searchQuery += clean;
    const start = this.searchIndex >= 0 ? this.searchIndex : this.history.length - 1;
    this.searchIndex = this.searchFrom(start);
    this.renderSearch();
  }

  // --- Completion --------------------------------------------------------

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
