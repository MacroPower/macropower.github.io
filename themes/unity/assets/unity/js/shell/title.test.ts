// The window title that the shell's prompt sets, as PS1 does in Ubuntu's
// default .bashrc. The test kit's terminal reads each title from the
// output, as xterm.js does, and index.ts carries it to the titlebar.

import { describe, expect, it } from "vitest";
import { stripAnsi, windowTitle } from "./ansi";
import { makeShell, TEST_DATA } from "./testkit";

const ENTER = "\r";

describe("the prompt's window title", () => {
  it("names the login and the home directory at the first prompt", () => {
    expect(makeShell().term.title()).toBe("me@example.com: ~");
  });

  it("follows each change of the working directory", () => {
    const sh = makeShell();
    sh.type("cd posts", ENTER);
    expect(sh.term.title()).toBe("me@example.com: ~/posts");
    sh.type("cd /etc", ENTER);
    expect(sh.term.title()).toBe("me@example.com: /etc");
    sh.type("cd", ENTER);
    expect(sh.term.title()).toBe("me@example.com: ~");
  });

  it("keeps the directory after a failed cd or a subshell's cd", () => {
    const sh = makeShell();
    sh.type("cd nope", ENTER);
    expect(sh.term.title()).toBe("me@example.com: ~");
    sh.type("echo $(cd /etc; pwd)", ENTER);
    expect(sh.term.title()).toBe("me@example.com: ~");
  });

  it("reports each prompt's title to the terminal's listeners", () => {
    const sh = makeShell();
    const titles: string[] = [];
    sh.term.onTitleChange((title) => { titles.push(title); });
    sh.type("cd posts", ENTER, "ls", ENTER);
    expect(titles).toEqual(["me@example.com: ~/posts", "me@example.com: ~/posts"]);
  });

  it("gives way to a title the visitor sets until the next prompt", () => {
    const sh = makeShell();
    sh.run("echo -e '\\0033]0;hello\\a'");
    expect(sh.term.title()).toBe("hello");
    sh.type("cd posts", ENTER);
    expect(sh.term.title()).toBe("me@example.com: ~/posts");
  });

  it("leaves the title alone when the island turns it off", () => {
    const sh = makeShell({ ...TEST_DATA, cwdTitle: false });
    sh.type("cd posts", ENTER);
    expect(sh.term.title()).toBe("");
    expect(sh.term.text()).not.toContain("\x1b]");
  });
});

describe("windowTitle", () => {
  it("drops the control characters that would end the sequence early", () => {
    expect(windowTitle("a\x07b\x1bc\x9cd")).toBe("\x1b]0;abcd\x07");
  });

  it("writes a sequence that stripAnsi removes", () => {
    expect(stripAnsi(`${windowTitle("me@host: ~")}me@host:~$ `)).toBe("me@host:~$ ");
    expect(stripAnsi("a\x1b]2;title\x1b\\b")).toBe("ab");
  });
});
