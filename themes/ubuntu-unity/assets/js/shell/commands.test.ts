// Command behavior that is JS-only (not bash-diffable): VFS-backed file output,
// our column/number formatting, stderr routing, and bash-format diagnostics.

import { describe, it, expect } from "vitest";
import { makeShell } from "./testkit";

describe("cat / file reads", () => {
  it("prints a file's contents", () => {
    expect(makeShell().run("cat README.md").stdout).toBe(
      "Welcome to Me Example's terminal.\nTry: ls, cd posts, cat about.txt, open github, help.\n",
    );
  });
  it("copies stdin when given no operands", () => {
    expect(makeShell().run("printf 'x\\ny\\n' | cat").stdout).toBe("x\ny\n");
  });
});

describe("text filters", () => {
  it("grep matches and -n prefixes line numbers", () => {
    const sh = makeShell();
    expect(sh.run("printf 'foo\\nbar\\nbaz\\n' | grep ba").stdout).toBe("bar\nbaz\n");
    expect(sh.run("printf 'a\\nb\\nc\\n' | grep -n b").stdout).toBe("2:b\n");
  });
  it("grep -c counts and -v inverts", () => {
    const sh = makeShell();
    expect(sh.run("printf 'a\\nb\\na\\n' | grep -c a").stdout).toBe("2\n");
    expect(sh.run("printf 'a\\nb\\n' | grep -v a").stdout).toBe("b\n");
  });
  it("head and tail slice lines", () => {
    const sh = makeShell();
    expect(sh.run("printf '1\\n2\\n3\\n4\\n' | head -n 2").stdout).toBe("1\n2\n");
    expect(sh.run("printf '1\\n2\\n3\\n4\\n' | tail -n 2").stdout).toBe("3\n4\n");
  });
  it("sort orders lines, -r reverses, -u dedupes", () => {
    const sh = makeShell();
    expect(sh.run("printf 'b\\na\\nc\\n' | sort").stdout).toBe("a\nb\nc\n");
    expect(sh.run("printf 'a\\nb\\n' | sort -r").stdout).toBe("b\na\n");
    expect(sh.run("printf 'a\\na\\nb\\n' | sort -u").stdout).toBe("a\nb\n");
  });
  it("wc counts lines/words/chars", () => {
    const sh = makeShell();
    expect(sh.run("printf 'a b\\nc\\n' | wc -l").stdout).toBe("2\n");
    expect(sh.run("printf 'a b\\nc\\n' | wc -w").stdout).toBe("3\n");
  });
});

describe("stderr routing", () => {
  it("sends cat's error to stderr, not stdout", () => {
    const r = makeShell().run("cat nope.txt");
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("cat: nope.txt: No such file or directory\n");
    expect(r.status).toBe(1);
  });
  it("does not pipe a command's stderr into the next stage", () => {
    // cat's error is suppressed; nothing reaches wc, so the count is 0.
    expect(makeShell().run("cat nope.txt 2>/dev/null | wc -l").stdout).toBe("0\n");
  });
  it("2>&1 merges stderr into stdout", () => {
    const r = makeShell().run("cat nope.txt 2>&1");
    expect(r.stdout).toBe("cat: nope.txt: No such file or directory\n");
    expect(r.stderr).toBe("");
  });
  it("a real redirection target fails like a read-only mount", () => {
    const r = makeShell().run("echo hi > out.txt");
    expect(r.stderr).toBe("bash: out.txt: Read-only file system\n");
    expect(r.status).toBe(1);
  });
});

describe("bash-format diagnostics", () => {
  it("cd reports missing directories the bash way", () => {
    const r = makeShell().run("cd nope");
    expect(r.stderr).toBe("bash: cd: nope: No such file or directory\n");
    expect(r.status).toBe(1);
  });
  it("cd reports a non-directory the bash way", () => {
    const r = makeShell().run("cd README.md");
    expect(r.stderr).toBe("bash: cd: README.md: Not a directory\n");
    expect(r.status).toBe(1);
  });
  it("an unknown command reports command not found with status 127", () => {
    const r = makeShell().run("frobnicate42");
    expect(r.stderr.split("\n")[0]).toBe("bash: frobnicate42: command not found");
    expect(r.status).toBe(127);
  });
});

describe("POSIX test against the VFS", () => {
  it("-f is true for a file, false for a directory", () => {
    const sh = makeShell();
    expect(sh.run("[ -f README.md ] && echo yes").stdout).toBe("yes\n");
    expect(sh.run("[ -f posts ] || echo no").stdout).toBe("no\n");
  });
  it("-d is true for a directory", () => {
    expect(makeShell().run("[ -d posts ] && echo yes").stdout).toBe("yes\n");
  });
  it("-e is true for anything that exists", () => {
    const sh = makeShell();
    expect(sh.run("[ -e README.md ] && echo yes").stdout).toBe("yes\n");
    expect(sh.run("[ -e nope ] || echo no").stdout).toBe("no\n");
  });
});

describe("command substitution isolation (JS-only)", () => {
  it("does not move the outer shell's cwd", () => {
    const sh = makeShell();
    sh.run("echo $(cd /etc)");
    expect(sh.run("pwd").stdout).toBe("/home/me\n");
  });
});
