import type { TerminalIO } from "./terminal";
import { Readline, type CompletionContext } from "./readline";
import { color, PALETTE, stripAnsi } from "./ansi";
import { buildFs, type Vfs } from "./vfs";
import { Env } from "./env";
import {
  parse, tokenizeWords, expandWord, isNullWord,
  type ParseEnv, type SimpleCommand,
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
}

// Buffers a pipeline stage's output, exposing it as plain (ANSI-stripped) lines
// for the next command's stdin.
class CaptureSink implements Sink {
  private buf = "";
  write(s: string): void { this.buf += s; }
  writeln(s: string): void { this.buf += `${s}\n`; }
  lines(): string[] {
    const parts = stripAnsi(this.buf).split("\n").map((l) => l.replace(/\r$/, ""));
    if (parts.length && parts[parts.length - 1] === "") parts.pop();
    return parts;
  }
}

const NULL_SINK: Sink = { write() {}, writeln() {} };

function isAssignment(tok: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(tok);
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
    for (const cmd of cmds) this.registry.set(cmd.name, cmd);
  }

  commands(): Command[] {
    return [...this.registry.values()];
  }

  /** Begin the read loop with a fresh prompt. */
  start(): void {
    this.prompt();
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
    if (parsed.error) {
      this.term.writeln(color(PALETTE.red, `bash: ${parsed.error}`));
      this.status = 2;
      return;
    }
    for (const stmt of parsed.statements) {
      if (stmt.connector === "&&" && this.status !== 0) continue;
      if (stmt.connector === "||" && this.status === 0) continue;
      this.status = this.runPipeline(stmt.pipeline);
    }
  }

  private runPipeline(cmds: SimpleCommand[]): number {
    let stdin: string[] = [];
    let code = 0;
    for (let i = 0; i < cmds.length; i += 1) {
      const cmd = cmds[i];
      if (!cmd) continue;
      const isLast = i === cmds.length - 1;

      let discard = false;
      if (cmd.redir) {
        const target = expandWord(cmd.redir.target, this.env);
        if (target === "/dev/null") {
          discard = true;
        } else {
          // The VFS is read-only, so any real redirection target fails the way
          // bash would on a read-only mount.
          this.term.writeln(color(PALETTE.red, `bash: ${target}: Read-only file system`));
          code = 1;
          stdin = [];
          continue;
        }
      }

      const toTerminal = isLast && !cmd.redir;
      const capture = !toTerminal && !discard ? new CaptureSink() : null;
      const out: Sink = toTerminal ? this.termSink : capture ?? NULL_SINK;
      code = this.runCommand(cmd, stdin, out);
      stdin = capture ? capture.lines() : [];
    }
    return code;
  }

  private runCommand(cmd: SimpleCommand, stdin: string[], out: Sink): number {
    // Expand parameters now, at execution time, so $? and same-line assignments
    // read the live value. Unquoted empty expansions are dropped (null words).
    let argv: string[] = [];
    for (const w of cmd.words) {
      const s = expandWord(w, this.env);
      if (isNullWord(w, s)) continue;
      argv.push(s);
    }

    // Leading NAME=value assignments configure the environment.
    while (argv.length && isAssignment(argv[0] ?? "")) {
      const tok = argv[0] ?? "";
      const eq = tok.indexOf("=");
      this.env.set(tok.slice(0, eq), tok.slice(eq + 1), { export: this.env.isExported(tok.slice(0, eq)) });
      argv = argv.slice(1);
    }
    if (argv.length === 0) return 0;

    argv = this.expandAlias(argv);
    const name = argv[0] ?? "";
    const command = this.registry.get(name);
    if (!command) {
      this.writeNotFound(name);
      return 127;
    }
    const r = command.run(this.makeContext(argv, stdin, out));
    return typeof r === "number" ? r : 0;
  }

  // One-level (loop-guarded) textual alias substitution of the command word.
  private expandAlias(argv: string[]): string[] {
    const seen = new Set<string>();
    let cur = argv;
    for (;;) {
      const head = cur[0] ?? "";
      if (!this.aliases.has(head) || seen.has(head)) break;
      seen.add(head);
      const words = tokenizeWords(this.aliases.get(head) ?? "", this.parseEnv())
        .map((w) => expandWord(w, this.env));
      if (words.length === 0) break;
      cur = [...words, ...cur.slice(1)];
    }
    return cur;
  }

  private writeNotFound(name: string): void {
    const suggestion = this.closest(name);
    const hint = suggestion ? `did you mean '${suggestion}'?` : "try 'help'";
    this.term.writeln(
      `${color(PALETTE.red, `command not found: ${name}`)}  ${color(PALETTE.muted, `(${hint})`)}`,
    );
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

  private makeContext(argv: string[], stdin: string[], out: Sink): CommandContext {
    return {
      name: argv[0] ?? "",
      args: argv.slice(1),
      argv,
      stdin,
      isTTY: out === this.termSink,
      write: (s) => { out.write(s); },
      writeln: (s) => { out.writeln(s); },
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
