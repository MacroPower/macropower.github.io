import type { TerminalIO } from "./terminal";
import { Readline, type CompletionContext } from "./readline";
import { color, PALETTE } from "./ansi";

export interface SocialLink {
  label: string;
  url: string;
  display: string;
}

// Single source of truth parsed from the JSON data island in index.html.
export interface ShellData {
  handle: string;
  host: string;
  name: string;
  title: string;
  uptime: string;
  socials: SocialLink[];
  ascii: string;
  colors: string;
}

export interface CommandContext {
  args: string[];
  /** Everything after the command token, verbatim (for echo). */
  raw: string;
  write(s: string): void;
  writeln(s: string): void;
  clear(): void;
  cwd(): string;
  setCwd(path: string): void;
  history(): readonly string[];
  commands(): Command[];
  term: TerminalIO;
  data: ShellData;
}

// Completion context handed to a command's complete(): the readline token
// state plus the shell data island (socials etc.).
export interface CompleteContext extends CompletionContext {
  data: ShellData;
}

export interface Command {
  name: string;
  summary: string;
  hidden?: boolean;
  complete?(ctx: CompleteContext): string[];
  run(ctx: CommandContext): void;
}

export class Shell {
  private readonly registry = new Map<string, Command>();
  private readonly readline: Readline;
  private cwdPath = "~";

  constructor(
    private readonly term: TerminalIO,
    readonly data: ShellData,
  ) {
    this.readline = new Readline(term, {
      onLine: (line) => { this.onLine(line); },
      complete: (ctx) => this.complete(ctx),
    });
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
    return (
      color(PALETTE.red, handle) +
      "@" +
      color(PALETTE.blue, host) +
      ":" +
      color(PALETTE.cyan, this.cwdPath) +
      "$ "
    );
  }

  private onLine(line: string): void {
    this.dispatch(line);
    this.prompt();
  }

  private dispatch(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    const tokens = trimmed.split(/\s+/);
    const name = tokens[0] ?? "";
    const cmd = this.registry.get(name);
    if (!cmd) {
      this.term.writeln(
        `${color(PALETTE.red, `command not found: ${name}`)}  ${color(PALETTE.muted, "(try 'help')")}`,
      );
      return;
    }
    cmd.run(this.makeContext(line, tokens.slice(1)));
  }

  private makeContext(line: string, args: string[]): CommandContext {
    const raw = line.replace(/^\s*\S+\s*/, "");
    return {
      args,
      raw,
      write: (s) => { this.term.write(s); },
      writeln: (s) => { this.term.writeln(s); },
      clear: () => { this.term.clear(); },
      cwd: () => this.cwdPath,
      setCwd: (p) => { this.cwdPath = p; },
      history: () => this.readline.getHistory(),
      commands: () => this.commands(),
      term: this.term,
      data: this.data,
    };
  }

  private complete(ctx: CompletionContext): string[] {
    if (ctx.index === 0) {
      return this.commands()
        .filter((c) => !c.hidden && c.name.startsWith(ctx.current))
        .map((c) => c.name);
    }
    const cmd = this.registry.get(ctx.tokens[0] ?? "");
    return cmd?.complete ? cmd.complete({ ...ctx, data: this.data }) : [];
  }
}
