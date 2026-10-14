// The line editor under keystrokes: editing, the kill ring, history, reverse
// search, completion, and the sanitizing of pasted text. Most cases drive a
// bare Readline and read the exact lines that Enter accepts. The shell cases
// type into makeShell() to check that the read loop runs each line and that
// Tab reaches the shell's completers and the VFS.

import { describe, expect, it, vi } from "vitest";
import { stripAnsi } from "./ansi";
import {
  Readline, stripControls, type CompleteFn, type ReadlineOptions,
} from "./readline";
import { CaptureTerminal, makeShell, type TestShell } from "./testkit";

// The input xterm.js sends for each key.
const KEY = {
  enter: "\r",
  tab: "\t",
  backspace: "\x7f",
  left: "\x1b[D",
  right: "\x1b[C",
  up: "\x1b[A",
  down: "\x1b[B",
  home: "\x1b[H",
  end: "\x1b[F",
  ctrlA: "\x01",
  ctrlC: "\x03",
  ctrlD: "\x04",
  ctrlE: "\x05",
  ctrlG: "\x07",
  ctrlK: "\x0b",
  ctrlL: "\x0c",
  ctrlR: "\x12",
  ctrlU: "\x15",
  ctrlW: "\x17",
  ctrlY: "\x19",
  altB: "\x1bb",
  altD: "\x1bd",
  altF: "\x1bf",
  f1: "\x1bOP",
  f5: "\x1b[15~",
} as const;

interface Editor {
  rl: Readline;
  term: CaptureTerminal;
  /** Every line that Enter accepted, in order. */
  lines: string[];
}

// A Readline behind the prompt "$ ". The host prompts again after each line,
// as Shell does, and the new prompt empties the buffer.
function editor(opts: Partial<ReadlineOptions> = {}): Editor {
  const term = new CaptureTerminal();
  const lines: string[] = [];
  const rl: Readline = new Readline(term, {
    ...opts,
    onLine: (line) => { lines.push(line); rl.prompt(); },
  });
  rl.setPrompt("$ ");
  rl.prompt();
  return { rl, term, lines };
}

// The terminal row that holds the input line, as last drawn: the text after
// the last carriage return or newline, without escape sequences.
function row(term: CaptureTerminal): string {
  const text = term.text();
  const start = Math.max(text.lastIndexOf("\r"), text.lastIndexOf("\n")) + 1;
  return stripAnsi(text.slice(start));
}

// A completer that offers each word starting with the token under the cursor.
function words(list: readonly string[]): CompleteFn {
  return (ctx) => list.filter((w) => w.startsWith(ctx.current));
}

describe("stripControls", () => {
  it("removes ESC, the other C0 controls, and DEL", () => {
    expect(stripControls("a\x1b[2Jb\x07c\x00d\x7fe")).toBe("a[2Jbcde");
  });

  it("removes the C1 controls, which xterm.js also reads", () => {
    expect(stripControls("a\u009b2Jb\u0085c\u0080d\u00a0e")).toBe("a2Jbcd\u00a0e");
  });

  it("removes tab, carriage return, and newline", () => {
    expect(stripControls("a\tb\r\nc")).toBe("abc");
  });

  it("keeps printable text outside ASCII", () => {
    expect(stripControls("café ✓ 😀")).toBe("café ✓ 😀");
  });
});

describe("Readline editing", () => {
  it("accepts the line on Enter", () => {
    const ed = editor();
    ed.term.type("echo hi", KEY.enter);
    expect(ed.lines).toEqual(["echo hi"]);
  });

  it("inserts at the cursor after Left and Right move it", () => {
    const ed = editor();
    ed.term.type("ac", KEY.left, "b", KEY.right, "d", KEY.enter);
    expect(ed.lines).toEqual(["abcd"]);
  });

  it("stops Left at the start of the line and Right at the end", () => {
    const ed = editor();
    ed.term.type("ab", KEY.right, "c", KEY.home, KEY.left, "_", KEY.enter);
    expect(ed.lines).toEqual(["_abc"]);
  });

  it("deletes before the cursor with Backspace and under it with Ctrl-D", () => {
    const ed = editor();
    ed.term.type("abxyc", KEY.left, KEY.backspace, KEY.left, KEY.ctrlD, KEY.enter);
    expect(ed.lines).toEqual(["abc"]);
  });

  it("jumps to the ends with Home and End, and with Ctrl-A and Ctrl-E", () => {
    const ed = editor();
    ed.term.type("bc", KEY.home, "a", KEY.end, "d", KEY.ctrlA, ">", KEY.ctrlE, "<", KEY.enter);
    expect(ed.lines).toEqual([">abcd<"]);
  });

  it("moves by word with Alt-B and Alt-F", () => {
    const ed = editor();
    ed.term.type("one two three", KEY.altB, KEY.altB, "X", KEY.altF, "Y", KEY.enter);
    expect(ed.lines).toEqual(["one XtwoY three"]);
  });

  it("abandons the line on Ctrl-C", () => {
    const ed = editor();
    ed.term.type("oops", KEY.ctrlC, "ok", KEY.enter);
    expect(ed.lines).toEqual(["ok"]);
    expect(ed.term.text()).toContain("^C");
  });

  it("calls onEof on Ctrl-D at an empty prompt", () => {
    const onEof = vi.fn();
    const ed = editor({ onEof });
    ed.term.type(KEY.ctrlD);
    expect(onEof).toHaveBeenCalledOnce();
    expect(ed.lines).toEqual([]);
  });

  it("redraws the line on a cleared screen on Ctrl-L", () => {
    const ed = editor();
    ed.term.type("ls", KEY.ctrlL);
    expect(stripAnsi(ed.term.text())).toBe("\r$ ls");
  });
});

describe("Readline kill ring", () => {
  it("yanks with Ctrl-Y the text that Ctrl-K killed to the end", () => {
    const ed = editor();
    ed.term.type("hello world", KEY.altB, KEY.ctrlK, KEY.ctrlA, KEY.ctrlY, KEY.enter);
    expect(ed.lines).toEqual(["worldhello "]);
  });

  it("kills to the start of the line with Ctrl-U", () => {
    const ed = editor();
    ed.term.type("abc def", KEY.altB, KEY.ctrlU, KEY.end, " ", KEY.ctrlY, KEY.enter);
    expect(ed.lines).toEqual(["def abc "]);
  });

  it("kills back to whitespace with Ctrl-W and keeps the kill for the next line", () => {
    const ed = editor();
    ed.term.type("cat ~/posts/a.md", KEY.ctrlW, KEY.enter, KEY.ctrlY, KEY.enter);
    expect(ed.lines).toEqual(["cat ", "~/posts/a.md"]);
  });

  it("kills the next word with Alt-D", () => {
    const ed = editor();
    ed.term.type("rm -rf now", KEY.ctrlA, KEY.altF, KEY.altD, KEY.enter);
    expect(ed.lines).toEqual(["rm now"]);
  });
});

describe("Readline history", () => {
  it("walks the history with Up and Down and restores the unfinished line", () => {
    const ed = editor();
    ed.term.type("first", KEY.enter, "second", KEY.enter, "dra", KEY.up);
    expect(row(ed.term)).toBe("$ second");
    ed.term.type(KEY.up);
    expect(row(ed.term)).toBe("$ first");
    ed.term.type(KEY.up);
    expect(row(ed.term)).toBe("$ first");
    ed.term.type(KEY.down);
    expect(row(ed.term)).toBe("$ second");
    ed.term.type(KEY.down);
    expect(row(ed.term)).toBe("$ dra");
    ed.term.type("ft", KEY.enter);
    expect(ed.lines).toEqual(["first", "second", "draft"]);
  });

  it("records nonblank lines but not a repeat of the newest", () => {
    const onHistoryChange = vi.fn();
    const ed = editor({ onHistoryChange });
    ed.term.type("ls", KEY.enter, "ls", KEY.enter, "  ", KEY.enter, "pwd", KEY.enter);
    expect(ed.lines).toEqual(["ls", "ls", "  ", "pwd"]);
    expect(ed.rl.getHistory()).toEqual(["ls", "pwd"]);
    expect(onHistoryChange).toHaveBeenCalledTimes(2);
  });

  it("recalls a seeded history and ignores Up without one", () => {
    const seeded = editor({ history: ["old"] });
    seeded.term.type(KEY.up, KEY.enter);
    expect(seeded.lines).toEqual(["old"]);
    const empty = editor();
    empty.term.type("x", KEY.up, KEY.enter);
    expect(empty.lines).toEqual(["x"]);
  });
});

describe("Readline reverse search", () => {
  const history = ["git status", "ls", "git log"];

  it("finds the newest match, steps to older ones on Ctrl-R, and runs it on Enter", () => {
    const ed = editor({ history });
    ed.term.type(KEY.ctrlR, "g", "i", "t");
    expect(row(ed.term)).toBe("(reverse-i-search)`git': git log");
    ed.term.type(KEY.ctrlR);
    expect(row(ed.term)).toBe("(reverse-i-search)`git': git status");
    ed.term.type(KEY.enter);
    expect(ed.lines).toEqual(["git status"]);
  });

  it("reports a failed search, and Backspace searches again", () => {
    const ed = editor({ history });
    ed.term.type(KEY.ctrlR, "l", "x");
    expect(row(ed.term)).toBe("(failed reverse-i-search)`lx': ");
    ed.term.type(KEY.backspace);
    expect(row(ed.term)).toBe("(reverse-i-search)`l': git log");
  });

  it("restores the line typed before the search on Ctrl-G", () => {
    const ed = editor({ history });
    ed.term.type("draft", KEY.ctrlR, "l", KEY.ctrlG);
    expect(row(ed.term)).toBe("$ draft");
    ed.term.type(KEY.enter);
    expect(ed.lines).toEqual(["draft"]);
  });

  it("accepts the match on an arrow key and then moves the cursor", () => {
    const ed = editor({ history: ["echo abc"] });
    ed.term.type(KEY.ctrlR, "a", "b", KEY.left, "X", KEY.enter);
    expect(ed.lines).toEqual(["echo abXc"]);
  });
});

describe("Readline completion", () => {
  it("passes the completer the tokens before the cursor and the token under it", () => {
    const complete = vi.fn<CompleteFn>(() => []);
    const ed = editor({ complete });
    ed.term.type("git che", KEY.tab);
    expect(complete).toHaveBeenLastCalledWith({ tokens: ["git"], current: "che", index: 1 });
    ed.term.type(KEY.ctrlU, "git ", KEY.tab);
    expect(complete).toHaveBeenLastCalledWith({ tokens: ["git"], current: "", index: 1 });
    ed.term.type(KEY.ctrlU, KEY.tab);
    expect(complete).toHaveBeenLastCalledWith({ tokens: [], current: "", index: 0 });
  });

  it("completes a lone candidate and adds a space", () => {
    const ed = editor({ complete: words(["echo"]) });
    ed.term.type("ec", KEY.tab, "hi", KEY.enter);
    expect(ed.lines).toEqual(["echo hi"]);
  });

  it("adds no space after a directory, so the next Tab continues the path", () => {
    const ed = editor({ complete: words(["posts/"]) });
    ed.term.type("cd po", KEY.tab, KEY.enter);
    expect(ed.lines).toEqual(["cd posts/"]);
  });

  it("extends to the common prefix, then lists the candidates on the next Tab", () => {
    const ed = editor({ complete: words(["foobar", "foobaz"]) });
    ed.term.type("f", KEY.tab);
    expect(row(ed.term)).toBe("$ fooba");
    ed.term.clear();
    ed.term.type(KEY.tab);
    expect(stripAnsi(ed.term.text())).toBe("\r\nfoobar  foobaz\n$ fooba");
    ed.term.type("r", KEY.enter);
    expect(ed.lines).toEqual(["foobar"]);
  });

  it("inserts nothing when no candidate matches or no completer is set", () => {
    const none = editor({ complete: words([]) });
    none.term.type("a", KEY.tab, "b", KEY.enter);
    expect(none.lines).toEqual(["ab"]);
    const bare = editor();
    bare.term.type("a", KEY.tab, "b", KEY.enter);
    expect(bare.lines).toEqual(["ab"]);
  });
});

describe("Readline input sanitizing", () => {
  it("inserts a pasted escape sequence without its ESC", () => {
    const ed = editor();
    ed.term.type("ab\x1b[2Jc", KEY.enter);
    expect(ed.lines).toEqual(["ab[2Jc"]);
    expect(ed.term.text()).not.toContain("\x1b[2J");
  });

  it("inserts a pasted C1 sequence without its CSI", () => {
    const ed = editor();
    ed.term.type("ab\u009b2Jc", KEY.enter);
    expect(ed.lines).toEqual(["ab2Jc"]);
    expect(ed.term.text()).not.toContain("\u009b");
  });

  it("drops the other control characters of a paste", () => {
    const ed = editor();
    ed.term.type("a\x07\x00b\tc", KEY.enter);
    expect(ed.lines).toEqual(["abc"]);
  });

  it("inserts a pasted line without running it", () => {
    const ed = editor();
    ed.term.type("ls\r");
    expect(ed.lines).toEqual([]);
    expect(row(ed.term)).toBe("$ ls");
    ed.term.type(KEY.enter);
    expect(ed.lines).toEqual(["ls"]);
  });

  it("ignores a key that sends an unmapped escape sequence", () => {
    const ed = editor();
    ed.term.type("a", KEY.f1, KEY.f5, "b", KEY.enter);
    expect(ed.lines).toEqual(["ab"]);
  });
});

// The lines the shell accepted from the keyboard, read back through the
// history builtin, which run() calls without adding to history.
function typedLines(sh: TestShell): string[] {
  const lines = sh.run("history").stdout.split("\n").slice(0, -1);
  return lines.map((l) => l.replace(/^ *\d+ {2}/, ""));
}

describe("shell line editing", () => {
  it("runs an accepted line and prompts again in the new directory", () => {
    const sh = makeShell();
    sh.type("cd posts", KEY.enter);
    expect(row(sh.term)).toBe("me@example.com:~/posts$ ");
    expect(sh.run("pwd").stdout).toBe("/home/me/posts\n");
    expect(typedLines(sh)).toEqual(["cd posts"]);
  });

  it("completes a command name", () => {
    const sh = makeShell();
    sh.type("expo", KEY.tab, "GREETING=hi", KEY.enter);
    expect(sh.run("echo $GREETING").stdout).toBe("hi\n");
  });

  it("completes a path in the VFS, then lists a directory's entries", () => {
    const sh = makeShell();
    sh.type("cat ~/po", KEY.tab);
    expect(row(sh.term)).toBe("me@example.com:~$ cat ~/posts/");
    sh.term.clear();
    sh.type(KEY.tab);
    expect(stripAnsi(sh.term.text())).toContain("~/posts/hello-world.md  ~/posts/second-post.md\n");
    sh.type("h", KEY.tab, KEY.enter);
    expect(typedLines(sh)).toEqual(["cat ~/posts/hello-world.md "]);
  });

  it("completes through each command's own completer", () => {
    const sh = makeShell();
    sh.type("cd ~/", KEY.tab, KEY.enter);
    expect(typedLines(sh)).toEqual(["cd ~/posts/"]);
  });

  it("completes a variable name after $", () => {
    const sh = makeShell();
    sh.type("echo $HOM", KEY.tab, KEY.enter);
    expect(typedLines(sh)).toEqual(["echo $HOME "]);
  });

  it("prints a hint on Ctrl-D at an empty prompt and prompts again", () => {
    const sh = makeShell();
    sh.type(KEY.ctrlD);
    expect(stripAnsi(sh.term.text())).toContain('Use "exit" to leave the shell.\n');
    expect(row(sh.term)).toBe("me@example.com:~$ ");
  });
});
