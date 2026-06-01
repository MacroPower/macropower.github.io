import type { TerminalIO } from "./terminal";
import { Readline, type CompletionContext } from "./readline";
import { color, PALETTE, stripAnsi } from "./ansi";
import { buildFs, globToRegExp, globToRegExpBody, splitLines, type Vfs } from "./vfs";
import { Env } from "./env";
import { evalArith } from "./arith";
import {
  parse, tokenizeWords,
  type ParseEnv, type ParseResult, type ParamExpr,
  type SimpleCommand, type Word, type WordPart,
} from "./parse";

export interface SocialLink {
  label: string;
  url: string;
  display: string;
}

// A blog post, emitted by Hugo from content/posts/ so the VFS need not
// hardcode the list. `url` is the real permalink; `date` is "YYYY-MM-DD".
// Posts carry only metadata (rendered as a card) -- their bodies would bloat
// the inline data island.
export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  categories: string[];
  url: string;
}

// A top-level content page (cv, sponsors, ...), emitted by Hugo with its raw
// markdown body so `cat` prints the source. `slug` is the on-disk basename.
export interface PageMeta {
  slug: string;
  date: string;
  url: string;
  content: string;
}

// Single source of truth parsed from the JSON data island in index.html.
export interface ShellData {
  handle: string;
  host: string;
  name: string;
  title: string;
  uptime: string;
  socials: SocialLink[];
  posts: PostMeta[];
  pages: PageMeta[];
  ascii: string;
  colors: string;
}

// A write target for a command's output. The terminal sink renders to xterm;
// a capture sink buffers output to feed the next stage of a pipeline; the null
// sink backs `> /dev/null`.
export interface Sink {
  write(s: string): void;
  writeln(s: string): void;
}

export interface CommandContext {
  /** Command name (argv[0]), post alias expansion. */
  name: string;
  /** Operands (argv[1..]). */
  args: string[];
  /** Full argument vector including the command name. */
  argv: string[];
  /** Lines piped in from the previous command (empty if none). */
  stdin: string[];
  /** True when output goes to the terminal, false when piped or redirected. */
  isTTY: boolean;
  write(s: string): void;
  writeln(s: string): void;
  /** Write to standard error (the active stderr sink), bypassing any pipe. */
  err(s: string): void;
  errln(s: string): void;
  clear(): void;
  cwd(): string;
  setCwd(path: string): void;
  history(): readonly string[];
  commands(): Command[];
  aliases: Map<string, string>;
  env: Env;
  /** Exit status of the previous command. */
  status(): number;
  term: TerminalIO;
  data: ShellData;
  vfs: Vfs;
}

// Completion context handed to a command's complete(): the readline token state
// plus the shell data island, VFS state, and the live command/alias names. The
// non-token fields are injected by Shell, not readline -- readline stays free
// of VFS/shell knowledge.
export interface CompleteContext extends CompletionContext {
  data: ShellData;
  cwd: string;
  vfs: Vfs;
  commandNames: string[];
  aliasNames: string[];
}

export interface Command {
  name: string;
  summary: string;
  /** One-line SYNOPSIS for `man`; defaults to the name. */
  usage?: string;
  /** DESCRIPTION paragraph for `man`; defaults to the summary. */
  details?: string;
  /** A shell builtin -- `type` reports it as such, and no /usr/bin program is
   *  installed for it (so `which` does not find it), matching bash. External
   *  commands (the default) get an executable stub under /usr/bin on register. */
  builtin?: boolean;
  hidden?: boolean;
  complete?(ctx: CompleteContext): string[];
  /** Returns the exit status; a void return is treated as 0 (success). */
  run(ctx: CommandContext): number | void;
}

export interface ShellOptions {
  /** Seed history (e.g. restored from localStorage). */
  history?: string[];
  /** Persist the full history after each accepted line. */
  persist?: (history: readonly string[]) => void;
  /** Sink for diagnostics; defaults to the terminal. Tests pass a capturing
   *  sink to read stderr separately from stdout. */
  stderr?: Sink;
}

// Buffers a pipeline stage's output, exposing it as plain (ANSI-stripped) lines
// for the next command's stdin, or as the raw buffer for command substitution.
class CaptureSink implements Sink {
  private buf = "";
  write(s: string): void { this.buf += s; }
  writeln(s: string): void { this.buf += `${s}\n`; }
  raw(): string { return this.buf; }
  lines(): string[] { return splitLines(stripAnsi(this.buf)); }
}

// Buffers a command's output bound for a `>`/`>>` file redirect, then commits it
// to the VFS at flush time. Deferring the write lets a bare `> dir` (empty argv)
// still surface bash's "Is a directory" via writeFile, and lets `> f 2>&1` merge
// both streams into one buffer written once.
class FileSink implements Sink {
  private buf = "";
  constructor(
    private readonly vfs: Vfs,
    private readonly path: string,
    /** The target as the user wrote it, for bash-style diagnostics. */
    readonly name: string,
    private readonly append: boolean,
  ) {}
  write(s: string): void { this.buf += s; }
  writeln(s: string): void { this.buf += `${s}\n`; }
  flush(): string | undefined { return this.vfs.writeFile(this.path, this.buf, { append: this.append }); }
}

const NULL_SINK: Sink = { write() {}, writeln() {} };

// Runtime services parameter expansion needs from the shell: variable access,
// assignment (for ${VAR:=word}), command substitution, arithmetic, and a
// diagnostics channel (for ${VAR:?word}).
export interface Expander {
  lookup(name: string): string;
  isSet(name: string): boolean;
  assign(name: string, value: string): void;
  runSub(prog: ParseResult): string;
  arith(expr: string): number;
  error(msg: string): void;
}

// A word is a leading assignment (NAME=value) when its first part is a literal
// matching NAME=; such words configure the environment instead of forming argv.
function isAssignmentWord(word: Word): boolean {
  const first = word.parts[0];
  return first !== undefined && "lit" in first && /^[A-Za-z_][A-Za-z0-9_]*=/.test(first.lit);
}

// Resolve one expansion part to its string value.
function expandPart(part: WordPart, exp: Expander): string {
  if ("lit" in part) return part.lit;
  if ("param" in part) return exp.lookup(part.param);
  if ("arith" in part) return String(exp.arith(part.arith));
  if ("cmdsub" in part) return exp.runSub(part.cmdsub);
  return evalParamExpr(part.paramExpr, exp);
}

// Concatenate a word's parts with no field splitting (used for assignment RHS
// and redirection targets).
export function expandNoSplit(word: Word, exp: Expander): string {
  let out = "";
  for (const part of word.parts) out += expandPart(part, exp);
  return out;
}

// Expand a word into fields. Unquoted expansion results undergo IFS word
// splitting (space/tab/newline); literals and quoted parts do not. A bare
// unquoted empty expansion contributes zero fields (a null word), while a
// quoted "" contributes one empty field.
export function expandFields(word: Word, exp: Expander): string[] {
  // An empty quoted word ("") has no parts but still contributes one field;
  // any other partless word (only possible when unquoted-and-empty) contributes
  // none.
  if (word.parts.length === 0) return word.quoted ? [""] : [];
  const fields: string[] = [];
  let current = "";
  let hasCurrent = false;
  const close = (): void => { if (hasCurrent) { fields.push(current); current = ""; hasCurrent = false; } };
  const appendLit = (s: string): void => { current += s; hasCurrent = true; };
  const appendSplit = (v: string): void => {
    if (v === "") return;
    const segs = v.split(/[ \t\n]+/);
    segs.forEach((tok, idx) => {
      if (idx === 0) { if (tok === "") close(); else appendLit(tok); }
      else { close(); if (tok !== "") appendLit(tok); }
    });
  };
  for (const part of word.parts) {
    if ("lit" in part) { appendLit(part.lit); continue; }
    const v = expandPart(part, exp);
    if (part.quoted) appendLit(v); else appendSplit(v);
  }
  close();
  return fields;
}

// Evaluate a ${VAR op word} expansion against the expander.
function evalParamExpr(pe: ParamExpr, exp: Expander): string {
  const { name, op, word } = pe;
  const set = exp.isSet(name);
  const val = exp.lookup(name);
  const operand = (): string => expandNoSplit(word, exp);
  const nullOrUnset = !set || val === "";
  switch (op) {
    case "len": return String(val.length);
    case ":-": return nullOrUnset ? operand() : val;
    case "-": return set ? val : operand();
    case ":+": return nullOrUnset ? "" : operand();
    case "+": return set ? operand() : "";
    case ":=": { if (nullOrUnset) { const o = operand(); exp.assign(name, o); return o; } return val; }
    case "=": { if (!set) { const o = operand(); exp.assign(name, o); return o; } return val; }
    // :? / ? report to stderr but, unlike bash, do not abort the command --
    // the expansion just yields "" (there is no command-level abort hook).
    case ":?": { if (nullOrUnset) { exp.error(`${name}: ${operand() || "parameter null or not set"}`); return ""; } return val; }
    case "?": { if (!set) { exp.error(`${name}: ${operand() || "parameter null or not set"}`); return ""; } return val; }
    case "#": return stripAffix(val, operand(), "prefix", false);
    case "##": return stripAffix(val, operand(), "prefix", true);
    case "%": return stripAffix(val, operand(), "suffix", false);
    case "%%": return stripAffix(val, operand(), "suffix", true);
    case "/": case "//": {
      const s = operand();
      const slash = s.indexOf("/");
      const pat = slash === -1 ? s : s.slice(0, slash);
      const repl = slash === -1 ? "" : s.slice(slash + 1);
      if (pat === "") return val;
      const re = new RegExp(globToRegExpBody(pat), op === "//" ? "g" : "");
      return val.replace(re, () => repl);
    }
    default: return val;
  }
}

// Remove the shortest (or longest) prefix/suffix of `value` matching `pattern`
// (a glob). No leading-dot rule -- ${VAR#pat} patterns are plain globs. `k` is
// the affix length tried; shortest scans up from 0, longest down from len.
function stripAffix(value: string, pattern: string, end: "prefix" | "suffix", longest: boolean): string {
  const re = globToRegExp(pattern);
  const len = value.length;
  const lengths = longest
    ? Array.from({ length: len + 1 }, (_, i) => len - i)
    : Array.from({ length: len + 1 }, (_, i) => i);
  for (const k of lengths) {
    if (end === "prefix") {
      if (re.test(value.slice(0, k))) return value.slice(k);
    } else if (re.test(value.slice(len - k))) {
      return value.slice(0, len - k);
    }
  }
  return value;
}

// Levenshtein distance, capped use for command "did you mean?" hints.
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const row = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i += 1) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = row[j] ?? 0;
      row[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, row[j] ?? 0, row[j - 1] ?? 0);
      prev = tmp;
    }
  }
  return row[n] ?? 0;
}

export class Shell {
  private readonly registry = new Map<string, Command>();
  private readonly readline: Readline;
  private readonly vfs: Vfs;
  private readonly env: Env;
  private readonly aliases = new Map<string, string>();
  private cwdPath: string;
  private status = 0;

  private readonly termSink: Sink;
  private readonly errSink: Sink;

  constructor(
    private readonly term: TerminalIO,
    readonly data: ShellData,
    opts: ShellOptions = {},
  ) {
    this.vfs = buildFs(data);
    this.cwdPath = this.vfs.homePath;
    this.env = new Env({ status: () => this.status });
    this.seedEnv();
    this.seedAliases();

    this.termSink = {
      write: (s) => { this.term.write(s); },
      writeln: (s) => { this.term.writeln(s); },
    };
    // Diagnostics route here; production keeps rendering them to the terminal,
    // while tests pass a capturing sink to read stderr apart from stdout.
    this.errSink = opts.stderr ?? this.termSink;

    this.readline = new Readline(term, {
      onLine: (line) => { this.onLine(line); },
      complete: (ctx) => this.complete(ctx),
      onEof: () => { this.onEof(); },
      history: opts.history,
      onHistoryChange: opts.persist,
    });
  }

  private seedEnv(): void {
    const { handle, host } = this.data;
    const e = this.env;
    e.set("HOME", this.vfs.homePath, { export: true });
    e.set("PWD", this.cwdPath, { export: true });
    e.set("USER", handle, { export: true });
    e.set("LOGNAME", handle, { export: true });
    e.set("HOSTNAME", host, { export: true });
    e.set("SHELL", "/bin/bash", { export: true });
    e.set("TERM", "xterm-256color", { export: true });
    e.set("LANG", "en_US.UTF-8", { export: true });
    e.set("PATH", "/usr/local/bin:/usr/bin:/bin", { export: true });
    e.set("EDITOR", "vim", { export: true });
    e.set("PAGER", "less", { export: true });
  }

  private seedAliases(): void {
    this.aliases.set("ll", "ls -la");
    this.aliases.set("la", "ls -a");
    this.aliases.set("l", "ls");
    this.aliases.set("..", "cd ..");
  }

  register(...cmds: Command[]): void {
    for (const cmd of cmds) {
      this.registry.set(cmd.name, cmd);
      // External programs gain a stub under /usr/bin so `which`/`type`/`ls`
      // resolve to a path that actually exists; builtins and hidden eggs do not.
      if (!cmd.builtin && !cmd.hidden) this.vfs.installBinary(cmd.name);
    }
  }

  commands(): Command[] {
    return [...this.registry.values()];
  }

  /** Begin the read loop with a fresh prompt. */
  start(): void {
    this.prompt();
  }

  // Execute one line without the readline/prompt machinery, returning its exit
  // status. The seam a headless driver (or a future `source`/scripting hook)
  // runs lines through.
  runLine(line: string): number {
    this.exec(line);
    return this.status;
  }

  private prompt(): void {
    this.readline.setPrompt(this.buildPrompt());
    this.readline.prompt();
  }

  private buildPrompt(): string {
    const { handle, host } = this.data;
    const tail = this.status === 0
      ? color(PALETTE.green, "$")
      : color(PALETTE.red, "$");
    return (
      color(PALETTE.red, handle) +
      "@" +
      color(PALETTE.blue, host) +
      ":" +
      color(PALETTE.cyan, this.vfs.displayPath(this.cwdPath)) +
      `${tail} `
    );
  }

  private parseEnv(): ParseEnv {
    return { home: this.env.get("HOME") ?? this.vfs.homePath };
  }

  private setCwd(p: string): void {
    this.env.set("OLDPWD", this.cwdPath, { export: true });
    this.cwdPath = p;
    this.env.set("PWD", p, { export: true });
  }

  private onLine(line: string): void {
    this.exec(line);
    this.prompt();
  }

  private onEof(): void {
    // Ctrl-D on an empty line. A web terminal cannot truly log out, so mirror
    // bash's ignoreeof guidance instead of dropping the user into a dead shell.
    this.term.writeln('Use "exit" to leave the shell.');
    this.prompt();
  }

  private exec(line: string): void {
    const parsed = parse(line, this.parseEnv());
    this.execParsed(parsed, this.termSink);
  }

  // Execute a parsed program, sending the terminal-bound stage's stdout to
  // `finalOut` (the terminal normally; a capture sink for command substitution).
  private execParsed(parsed: ParseResult, finalOut: Sink): void {
    if (parsed.error) {
      this.errSink.writeln(color(PALETTE.red, `bash: ${parsed.error}`));
      this.status = 2;
      return;
    }
    for (const stmt of parsed.statements) {
      if (stmt.connector === "&&" && this.status !== 0) continue;
      if (stmt.connector === "||" && this.status === 0) continue;
      this.status = this.runPipeline(stmt.pipeline, finalOut);
    }
  }

  // The services parameter expansion calls back into. Command substitution runs
  // through this same shell into a capture sink.
  private expander(): Expander {
    return {
      lookup: (n) => this.env.lookup(n),
      isSet: (n) => this.env.isSet(n),
      assign: (n, v) => { this.env.set(n, v, { export: this.env.isExported(n) }); },
      runSub: (p) => this.runSub(p),
      arith: (e) => this.runArith(e),
      error: (m) => { this.errSink.writeln(color(PALETTE.red, `bash: ${m}`)); },
    };
  }

  private runArith(expr: string): number {
    try {
      return evalArith(expr, (n) => this.env.lookup(n));
    } catch {
      this.errSink.writeln(color(PALETTE.red, `bash: ${expr}: arithmetic syntax error`));
      return 0;
    }
  }

  // Run a command substitution in an isolated subshell: cwd and the full
  // variable state are snapshotted and restored so `$(cd /etc)` does not move
  // the outer shell. `$?` is intentionally left as the sub's last status (bash
  // behavior). All trailing newlines are stripped, as bash collapses them.
  private runSub(prog: ParseResult): string {
    const savedCwd = this.cwdPath;
    const savedEnv = this.env.snapshot();
    const cap = new CaptureSink();
    this.execParsed(prog, cap);
    this.cwdPath = savedCwd;
    this.env.restore(savedEnv);
    return stripAnsi(cap.raw()).replace(/\n+$/, "");
  }

  private runPipeline(cmds: SimpleCommand[], finalOut: Sink): number {
    let stdin: string[] = [];
    let code = 0;
    const exp = this.expander();
    for (let i = 0; i < cmds.length; i += 1) {
      const cmd = cmds[i];
      if (!cmd) continue;
      const isLast = i === cmds.length - 1;
      const capture = isLast ? null : new CaptureSink();
      let out: Sink = isLast ? finalOut : (capture ?? NULL_SINK);
      let err: Sink = this.errSink;
      let stdinOverride: string[] | null = null;
      const fileSinks: FileSink[] = [];

      // Redirects apply left-to-right: a dup (2>&1) aliases whatever the target
      // fd points at *at that moment*, so `> f 2>&1` and `2>&1 > f` diverge.
      let blocked = false;
      for (const r of cmd.redirs) {
        if (r.kind === "read") {
          const target = expandNoSplit(r.target, exp);
          const node = this.vfs.lookup(this.vfs.resolvePath(this.cwdPath, target));
          if (!node) { this.errSink.writeln(color(PALETTE.red, `bash: ${target}: No such file or directory`)); blocked = true; break; }
          if (node.kind === "dir") { this.errSink.writeln(color(PALETTE.red, `bash: ${target}: Is a directory`)); blocked = true; break; }
          // Last `<` wins; overrides any upstream pipe output.
          stdinOverride = node.content().map(stripAnsi);
        } else if (r.kind === "file") {
          const target = expandNoSplit(r.target, exp);
          if (target === "/dev/null") {
            if (r.fd === 2) err = NULL_SINK; else out = NULL_SINK;
            continue;
          }
          // Validate parent existence at setup (bash opens redirs before
          // running); the target-is-a-directory case is surfaced by writeFile
          // at flush time, so a bare `> existing-dir` still reports it.
          const abs = this.vfs.resolvePath(this.cwdPath, target);
          const parent = this.vfs.lookup(this.vfs.resolvePath(abs, ".."));
          if (!parent || parent.kind !== "dir") {
            this.errSink.writeln(color(PALETTE.red, `bash: ${target}: No such file or directory`));
            blocked = true;
            break;
          }
          const sink = new FileSink(this.vfs, abs, target, r.op === ">>");
          fileSinks.push(sink);
          if (r.fd === 2) err = sink; else out = sink;
        } else if (r.fd === 2 && r.toFd === 1) {
          err = out;
        } else if (r.fd === 1 && r.toFd === 2) {
          out = err;
        }
      }
      // The command only runs if every redirect opened; a failure leaves it
      // unexecuted (status 1) but still commits the file redirects staged before
      // the failure, so `echo x > f < nope` truncates f the way bash does (its
      // buffer is empty since the command never wrote).
      if (blocked) code = 1;
      else code = this.runCommand(cmd, stdinOverride ?? stdin, out, err);

      // Commit file redirects (deduped by identity so `> f 2>&1` writes once).
      for (const sink of new Set(fileSinks)) {
        const e = sink.flush();
        if (e) { this.errSink.writeln(color(PALETTE.red, `bash: ${sink.name}: ${e}`)); code = 1; }
      }

      stdin = blocked ? [] : (capture && out === capture ? capture.lines() : []);
    }
    return code;
  }

  private runCommand(cmd: SimpleCommand, stdin: string[], out: Sink, err: Sink): number {
    const exp = this.expander();

    // Leading NAME=value assignments configure the environment. The RHS is
    // expanded without word splitting (bash assignment semantics).
    let wi = 0;
    while (wi < cmd.words.length && isAssignmentWord(cmd.words[wi] as Word)) {
      const tok = expandNoSplit(cmd.words[wi] as Word, exp);
      const eq = tok.indexOf("=");
      this.env.set(tok.slice(0, eq), tok.slice(eq + 1), { export: this.env.isExported(tok.slice(0, eq)) });
      wi += 1;
    }

    // Expand the remaining words into fields, then apply filename globbing to
    // any word that carried an unquoted glob metacharacter.
    let argv: string[] = [];
    for (let k = wi; k < cmd.words.length; k += 1) {
      const w = cmd.words[k] as Word;
      const fields = expandFields(w, exp);
      if (!w.hasUnquotedGlob) { argv.push(...fields); continue; }
      for (const f of fields) {
        const matches = this.vfs.glob(this.cwdPath, f);
        if (matches.length) argv.push(...matches); else argv.push(f);
      }
    }
    if (argv.length === 0) return 0;

    argv = this.expandAlias(argv);
    const name = argv[0] ?? "";
    const command = this.registry.get(name);
    if (!command) {
      this.writeNotFound(name, err, out === this.termSink);
      return 127;
    }
    // External programs run only while their binary still exists on $PATH:
    // delete /usr/bin/ls (or wipe the tree) and `ls` becomes "command not
    // found", just like bash. Builtins need no file, and hidden eggs ship no
    // stub, so both bypass the check.
    if (!command.builtin && !command.hidden
      && !this.vfs.resolveCommand(name, this.cwdPath, this.env.lookup("PATH"))) {
      err.writeln(color(PALETTE.red, `bash: ${name}: command not found`));
      return 127;
    }
    const r = command.run(this.makeContext(argv, stdin, out, err));
    return typeof r === "number" ? r : 0;
  }

  // One-level (loop-guarded) textual alias substitution of the command word.
  private expandAlias(argv: string[]): string[] {
    const exp = this.expander();
    const seen = new Set<string>();
    let cur = argv;
    for (;;) {
      const head = cur[0] ?? "";
      if (!this.aliases.has(head) || seen.has(head)) break;
      seen.add(head);
      const expanded = tokenizeWords(this.aliases.get(head) ?? "", this.parseEnv())
        .flatMap((w) => expandFields(w, exp));
      if (expanded.length === 0) break;
      cur = [...expanded, ...cur.slice(1)];
    }
    return cur;
  }

  private writeNotFound(name: string, err: Sink, isTTY: boolean): void {
    err.writeln(color(PALETTE.red, `bash: ${name}: command not found`));
    // Keep the friendly hint, but only on an interactive terminal -- a pipe or
    // capture must see the bash-accurate message alone.
    if (isTTY) {
      const suggestion = this.closest(name);
      if (suggestion) err.writeln(color(PALETTE.muted, `(did you mean '${suggestion}'?)`));
    }
  }

  private closest(name: string): string | null {
    const candidates = [
      ...this.commands().filter((c) => !c.hidden).map((c) => c.name),
      ...this.aliases.keys(),
    ];
    let best: string | null = null;
    let bestD = Infinity;
    for (const cand of candidates) {
      const d = editDistance(name, cand);
      if (d < bestD) { bestD = d; best = cand; }
    }
    return best && bestD <= 2 && bestD < name.length ? best : null;
  }

  private makeContext(argv: string[], stdin: string[], out: Sink, err: Sink): CommandContext {
    return {
      name: argv[0] ?? "",
      args: argv.slice(1),
      argv,
      stdin,
      isTTY: out === this.termSink,
      write: (s) => { out.write(s); },
      writeln: (s) => { out.writeln(s); },
      err: (s) => { err.write(s); },
      errln: (s) => { err.writeln(s); },
      clear: () => { this.term.clear(); },
      cwd: () => this.cwdPath,
      setCwd: (p) => { this.setCwd(p); },
      history: () => this.readline.getHistory(),
      commands: () => this.commands(),
      aliases: this.aliases,
      env: this.env,
      status: () => this.status,
      term: this.term,
      data: this.data,
      vfs: this.vfs,
    };
  }

  private complete(ctx: CompletionContext): string[] {
    // Variable-name completion after a bare $ or ${.
    if (ctx.current.startsWith("$")) {
      const rest = ctx.current.slice(1);
      const brace = rest.startsWith("{");
      const stem = brace ? rest.slice(1) : rest;
      return this.env.names()
        .filter((nm) => nm.startsWith(stem))
        .map((nm) => (brace ? `\${${nm}}` : `$${nm}`));
    }
    if (ctx.index === 0) {
      const names = new Set<string>([
        ...this.commands().filter((c) => !c.hidden).map((c) => c.name),
        ...this.aliases.keys(),
      ]);
      return [...names].filter((nm) => nm.startsWith(ctx.current)).sort();
    }
    const cmd = this.registry.get(ctx.tokens[0] ?? "");
    if (!cmd?.complete) return [];
    return cmd.complete({
      ...ctx,
      data: this.data,
      cwd: this.cwdPath,
      vfs: this.vfs,
      commandNames: this.commands().filter((c) => !c.hidden).map((c) => c.name),
      aliasNames: [...this.aliases.keys()],
    });
  }
}
