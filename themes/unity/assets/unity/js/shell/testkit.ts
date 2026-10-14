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

// The OSC 0 and OSC 2 sequences that set the window title, as xterm.js
// parses them.
const TITLE_RE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;

// A TerminalIO that buffers all its output. writeln appends a bare "\n",
// never "\r\n", as bash ends its lines, so stdout compares cleanly. type()
// stands in for the keyboard.
export class CaptureTerminal implements TerminalIO {
  private buf = "";
  private readonly listeners: ((data: string) => void)[] = [];
  private readonly titleListeners: ((title: string) => void)[] = [];
  private lastTitle = "";
  write(s: string): void {
    this.buf += s;
    for (const [, title = ""] of s.matchAll(TITLE_RE)) {
      this.lastTitle = title;
      for (const cb of this.titleListeners) cb(title);
    }
  }
  writeln(s: string): void { this.write(`${s}\n`); }
  clear(): void { this.buf = ""; }
  text(): string { return this.buf; }
  /** The window title the output set last, or "" before any. clear()
   *  keeps it, as clearing a terminal keeps its title. */
  title(): string { return this.lastTitle; }
  cols(): number { return 80; }
  focus(): void { /* no-op */ }
  fit(): void { /* no-op */ }
  registerLinks(): void { /* no-op */ }
  onData(cb: (data: string) => void): void { this.listeners.push(cb); }
  onTitleChange(cb: (title: string) => void): void { this.titleListeners.push(cb); }
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
  cwdTitle: true,
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
  /** Execute one line. Returns stdout and stderr with ANSI stripped, and the
   *  exit code as status. Each call clears the buffers first. */
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
// machine. The table stays read-only by policy, and the in-memory makeShell
// golden tests cover behavior that changes files. This guard refuses to spawn
// a program that names a mutating command, so a stray row fails loudly
// instead of running. The guard lets `>` and `>>` through on purpose, because
// existing rows use fd dups and `2>/dev/null`. The command-name list would
// still catch a real `>` target here if it mattered.
const MUTATING_COMMAND = /\b(rm|rmdir|mkdir|mv|cp|touch|tee|dd|ln|shred|truncate|chmod|chown|install|mkfifo|mknod)\b/;

// Run a program through a clean, locale-pinned bash. --norc and --noprofile
// keep dotfiles out, and LC_ALL=C fixes collation to byte order.
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
// through real bash, and assert that stdout and the exit status agree. The
// check compares only stdout and the status and leaves the capturing stderr
// sink out, because bash's stderr format differs and the table does not
// cover it.
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
