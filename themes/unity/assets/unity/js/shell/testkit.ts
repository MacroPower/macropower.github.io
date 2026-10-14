// Headless test harness for the shell core. The core imports ./terminal as a
// type only, so a fake TerminalIO drives a real Shell under Node with no xterm
// or DOM. Type-checked by tsconfig.test.json (node-aware); never bundled by
// Hugo (only index.ts is an entrypoint), and never run by Vitest (not a
// *.test.ts file).

import { spawnSync } from "node:child_process";
import { expect } from "vitest";
import type { TerminalIO } from "./terminal";
import { Shell, type ShellData, type Sink } from "./shell";
import { registerAll } from "./commands/all";
import { stripAnsi } from "./ansi";

// A TerminalIO that buffers everything written to it. writeln appends a bare
// "\n" (never "\r\n"), matching bash's line endings so stdout compares cleanly.
// type() stands in for the keyboard.
export class CaptureTerminal implements TerminalIO {
  private buf = "";
  private readonly listeners: ((data: string) => void)[] = [];
  write(s: string): void { this.buf += s; }
  writeln(s: string): void { this.buf += `${s}\n`; }
  clear(): void { this.buf = ""; }
  text(): string { return this.buf; }
  cols(): number { return 80; }
  focus(): void { /* no-op */ }
  fit(): void { /* no-op */ }
  registerLinks(): void { /* no-op */ }
  onData(cb: (data: string) => void): void { this.listeners.push(cb); }
  dispose(): void { /* no-op */ }

  /** Sends input to every onData listener. Each argument arrives as one
   *  event, as one keypress or one paste does from xterm.js, so `type("ls",
   *  "\r")` runs ls, but `type("ls\r")` is a paste that inserts "ls" without
   *  running it. */
  type(...keys: string[]): void {
    for (const key of keys) {
      for (const cb of this.listeners) cb(key);
    }
  }
}

// A deterministic data fixture: fixed handle/host/posts/pages so the VFS and
// every ls/glob/cat output is stable across runs.
export const TEST_DATA: Readonly<ShellData> = {
  handle: "me",
  host: "example.com",
  name: "Me Example",
  title: "Tinkerer",
  focus: "Tinkering & General Mischief",
  uptime: "3 days, 4 hours",
  socials: [
    { label: "github", url: "github.com/me", display: "github.com/me" },
    { label: "mastodon", url: "example.social/@me", display: "example.social/@me" },
  ],
  posts: [
    { slug: "hello-world", title: "Hello World", date: "2024-01-01", categories: ["meta"], url: "/posts/2024/01/hello-world/", permalink: "https://example.org/posts/2024/01/hello-world/" },
    { slug: "second-post", title: "Second Post", date: "2024-03-15", categories: ["notes"], url: "/posts/2024/03/second-post/", permalink: "https://example.org/posts/2024/03/second-post/" },
  ],
  pages: [
    { slug: "cv", date: "2024-02-02", url: "/cv/", content: "# CV\n\nA short resume.\n" },
  ],
  blog: { dir: "posts", url: "/posts/" },
  ascii: "ME",
  colors: "",
};

export interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

export interface TestShell {
  shell: Shell;
  /** The shell's terminal. Its text() holds what the shell wrote since the
   *  last clear(). */
  term: CaptureTerminal;
  /** Execute one line; stdout/stderr are returned ANSI-stripped, status is the
   *  exit code. Buffers are cleared before each call. */
  run(line: string): RunResult;
  /** Send keys to the shell's line editor through term.type(). A line that
   *  Enter accepts runs through the read loop and enters history. */
  type(...keys: string[]): void;
}

// Build a Shell backed by a CaptureTerminal and a capturing stderr sink, with
// every command registered through the shared list. One persistent shell, so
// state (X=1 then echo $X) carries across run() and type() calls. The read
// loop starts as in production, so type() edits behind a real prompt.
export function makeShell(data: ShellData = TEST_DATA): TestShell {
  const term = new CaptureTerminal();
  let errBuf = "";
  const stderr: Sink = {
    write: (s) => { errBuf += s; },
    writeln: (s) => { errBuf += `${s}\n`; },
  };
  const shell = new Shell(term, data, { stderr });
  registerAll(shell);
  shell.start();
  return {
    shell,
    term,
    type(...keys: string[]): void { term.type(...keys); },
    run(line: string): RunResult {
      term.clear();
      errBuf = "";
      const status = shell.runLine(line);
      return { stdout: stripAnsi(term.text()), stderr: stripAnsi(errBuf), status };
    },
  };
}

let bashProbe: boolean | undefined;

// Whether a real bash is on PATH (cached). Conformance suites skipIf(!this).
export function bashAvailable(): boolean {
  if (bashProbe === undefined) {
    const r = spawnSync("bash", ["-c", "exit 0"], { encoding: "utf8" });
    bashProbe = r.status === 0;
  }
  return bashProbe;
}

export interface BashResult {
  stdout: string;
  status: number;
}

// Conformance rows run through the *real* host bash with the real PATH and
// vitest's cwd, so a filesystem-mutating program would touch the developer's
// machine. The table is read-only by policy (FS-mutating behavior is covered by
// in-memory makeShell golden tests, never here); this guard refuses to spawn a
// program that names a mutating command so a stray row fails loudly instead of
// running. `>`/`>>` are intentionally not blocked -- existing rows use fd dups
// and `2>/dev/null`, and any real `>` target here would still be caught by the
// command-name list if it mattered.
const MUTATING_COMMAND = /\b(rm|rmdir|mkdir|mv|cp|touch|tee|dd|ln|shred|truncate|chmod|chown|install|mkfifo|mknod)\b/;

// Run a program through a clean, locale-pinned bash. --norc/--noprofile keep
// it free of dotfile influence; LC_ALL=C fixes collation to byte order.
export function runBash(program: string): BashResult {
  if (MUTATING_COMMAND.test(program)) {
    throw new Error(
      `runBash refused a filesystem-mutating program: ${JSON.stringify(program)}. ` +
      "Conformance rows must be read-only; assert FS-mutating behavior with makeShell instead.",
    );
  }
  const r = spawnSync("bash", ["--norc", "--noprofile", "-c", program], {
    env: { PATH: process.env.PATH ?? "", HOME: "/home/me", USER: "me", LC_ALL: "C" },
    encoding: "utf8",
  });
  return { stdout: r.stdout ?? "", status: r.status ?? 0 };
}

// Run `program` through our shell (line by line on one persistent shell) and
// through real bash, asserting stdout and exit status agree. Only stdout and
// status are compared; the capturing stderr sink is not diffed (bash stderr
// formatting differs and is not in scope for the table).
export function expectMatchesBash(program: string): void {
  const sh = makeShell();
  let stdout = "";
  let status = 0;
  for (const line of program.split("\n")) {
    const r = sh.run(line);
    stdout += r.stdout;
    status = r.status;
  }
  const bash = runBash(program);
  expect(stdout, `stdout mismatch for: ${program}`).toBe(bash.stdout);
  expect(status, `status mismatch for: ${program}`).toBe(bash.status);
}
