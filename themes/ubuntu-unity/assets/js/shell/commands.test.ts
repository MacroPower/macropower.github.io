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
});

describe("writable filesystem", () => {
  it("creates a file with > and reads it back with no trailing blank", () => {
    const sh = makeShell();
    sh.run("echo hi > f");
    expect(sh.run("cat f").stdout).toBe("hi\n");
  });
  it("appends with >>", () => {
    const sh = makeShell();
    sh.run("echo one > f");
    sh.run("echo two >> f");
    expect(sh.run("cat f").stdout).toBe("one\ntwo\n");
  });
  it("truncates an existing file with >", () => {
    const sh = makeShell();
    sh.run("printf 'a\\nb\\nc\\n' > f");
    sh.run("echo z > f");
    expect(sh.run("cat f").stdout).toBe("z\n");
  });
  it("reads stdin from a file with <", () => {
    const sh = makeShell();
    sh.run("printf 'b\\na\\nc\\n' > f");
    expect(sh.run("sort < f").stdout).toBe("a\nb\nc\n");
  });
  it("combines < input with a downstream pipe", () => {
    const sh = makeShell();
    sh.run("printf 'x\\ny\\nz\\n' > f");
    expect(sh.run("cat < f | wc -l").stdout).toBe("3\n");
  });
  it("distinguishes > f 2>&1 from 2>&1 > f", () => {
    const sh = makeShell();
    // `> a 2>&1`: stderr aliases the file, so both streams land in a.
    sh.run("ls nope > a 2>&1");
    expect(sh.run("cat a").stdout).toBe("ls: cannot access 'nope': No such file or directory\n");
    // `2>&1 > b`: stderr aliases the stdout *device* (still the terminal) before
    // `> b` retargets stdout, so the error reaches the terminal, not the file.
    const r = sh.run("ls nope 2>&1 > b");
    expect(r.stdout).toBe("ls: cannot access 'nope': No such file or directory\n");
    expect(sh.run("cat b").stdout).toBe("");
  });
  it("a bare > creates an empty file", () => {
    const sh = makeShell();
    sh.run("> empty");
    expect(sh.run("[ -f empty ] && wc -l empty").stdout).toBe("0 empty\n");
  });
  it("redirecting onto a directory reports Is a directory", () => {
    const r = makeShell().run("echo x > posts");
    expect(r.stderr).toBe("bash: posts: Is a directory\n");
    expect(r.status).toBe(1);
  });
  it("redirecting into a missing directory reports No such file or directory", () => {
    const r = makeShell().run("echo x > nodir/f");
    expect(r.stderr).toBe("bash: nodir/f: No such file or directory\n");
    expect(r.status).toBe(1);
  });
  it("reading a missing file fails and skips the command", () => {
    const r = makeShell().run("cat < nope");
    expect(r.stderr).toBe("bash: nope: No such file or directory\n");
    expect(r.status).toBe(1);
  });
  it("opens redirects left-to-right, committing those staged before a failure", () => {
    const sh = makeShell();
    // `> f` opens (truncates) before `< nope` fails; f is left empty.
    sh.run("printf 'old\\n' > f");
    expect(sh.run("echo x > f < nope").status).toBe(1);
    expect(sh.run("[ -f f ] && wc -l f").stdout).toBe("0 f\n");
    // Reverse order: `< nope` fails first, so `> g` is never opened and a
    // pre-existing g is untouched.
    sh.run("printf 'keep\\n' > g");
    expect(sh.run("cat < nope > g").status).toBe(1);
    expect(sh.run("cat g").stdout).toBe("keep\n");
  });
  it("a created file lists with a stable size under ls -l", () => {
    const sh = makeShell();
    sh.run("echo hello > note.txt"); // "hello\n" -> 6 bytes
    const line = sh.run("ls -l note.txt").stdout.trim();
    expect(line).toContain("-rw-r--r--");
    expect(line).toContain(" 6 ");
    expect(line.endsWith("note.txt")).toBe(true);
  });
});

describe("file-mutation commands", () => {
  it("mkdir -p creates nested directories", () => {
    const sh = makeShell();
    expect(sh.run("mkdir -p a/b/c").status).toBe(0);
    expect(sh.run("ls a").stdout).toBe("b/\n");
    expect(sh.run("ls a/b").stdout).toBe("c/\n");
  });
  it("rmdir refuses a non-empty directory", () => {
    const sh = makeShell();
    sh.run("mkdir d");
    sh.run("touch d/f");
    const r = sh.run("rmdir d");
    expect(r.stderr).toBe("rmdir: failed to remove 'd': Directory not empty\n");
    expect(r.status).toBe(1);
  });
  it("rm refuses a directory without -r", () => {
    const sh = makeShell();
    sh.run("mkdir d");
    const r = sh.run("rm d");
    expect(r.stderr).toBe("rm: cannot remove 'd': Is a directory\n");
    expect(sh.run("rm -r d").status).toBe(0);
    expect(sh.run("ls d").status).toBe(2);
  });
  it("rm -f ignores a missing file", () => {
    const r = makeShell().run("rm -f nope");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
  it("rm -rf / hits the GNU preserve-root failsafe", () => {
    const r = makeShell().run("rm -rf /");
    expect(r.stderr).toBe(
      "rm: it is dangerous to operate recursively on '/'\n" +
      "rm: use --no-preserve-root to override this failsafe\n",
    );
    expect(r.status).toBe(1);
    // the tree survived
    expect(makeShell().run("ls / | head -n1").status).toBe(0);
  });
  it("a non-recursive rm / still reports Is a directory", () => {
    const r = makeShell().run("rm /");
    expect(r.stderr).toBe("rm: cannot remove '/': Is a directory\n");
    expect(r.status).toBe(1);
  });
  it("rm -rf --no-preserve-root / empties the session tree", () => {
    const sh = makeShell();
    expect(sh.run("rm -rf --no-preserve-root /").status).toBe(0);
    expect(sh.run("ls /").stdout).toBe("");
  });
  it("deleting a binary makes it uninvokable", () => {
    const sh = makeShell();
    expect(sh.run("cat README.md").status).toBe(0);
    sh.run("rm /usr/bin/cat");
    const r = sh.run("cat README.md");
    expect(r.stderr).toBe("bash: cat: command not found\n");
    expect(r.status).toBe(127);
  });
  it("after wiping the tree, builtins survive but binaries do not", () => {
    const sh = makeShell();
    sh.run("rm -rf --no-preserve-root /");
    // builtins need no file on disk
    expect(sh.run("echo hello").stdout).toBe("hello\n");
    expect(sh.run("cd /").status).toBe(0);
    // external programs are gone
    const r = sh.run("ls");
    expect(r.stderr).toBe("bash: ls: command not found\n");
    expect(r.status).toBe(127);
  });
  it("cp -r deep-copies a directory independently", () => {
    const sh = makeShell();
    sh.run("mkdir src");
    sh.run("echo hi > src/a");
    expect(sh.run("cp -r src dst").status).toBe(0);
    expect(sh.run("cat dst/a").stdout).toBe("hi\n");
    sh.run("echo changed > src/a");
    expect(sh.run("cat dst/a").stdout).toBe("hi\n"); // clone, not a shared ref
  });
  it("cp without -r omits a directory", () => {
    const sh = makeShell();
    sh.run("mkdir src");
    const r = sh.run("cp src dst");
    expect(r.stderr).toBe("cp: -r not specified; omitting directory 'src'\n");
    expect(r.status).toBe(1);
  });
  it("mv renames a file", () => {
    const sh = makeShell();
    sh.run("echo hi > a");
    expect(sh.run("mv a b").status).toBe(0);
    expect(sh.run("cat b").stdout).toBe("hi\n");
    expect(sh.run("cat a").status).toBe(1);
  });
  it("mv drops a file into an existing directory", () => {
    const sh = makeShell();
    sh.run("echo hi > a");
    sh.run("mkdir d");
    sh.run("mv a d");
    expect(sh.run("cat d/a").stdout).toBe("hi\n");
  });
});

describe("tee writes through the VFS", () => {
  it("copies stdin to a file and to stdout", () => {
    const sh = makeShell();
    expect(sh.run("printf 'a\\nb\\n' | tee out").stdout).toBe("a\nb\n");
    expect(sh.run("cat out").stdout).toBe("a\nb\n");
  });
  it("tee -a appends", () => {
    const sh = makeShell();
    sh.run("echo one | tee f");
    sh.run("echo two | tee -a f");
    expect(sh.run("cat f").stdout).toBe("one\ntwo\n");
  });
});

describe("new text filters", () => {
  it("cut selects fields and characters", () => {
    const sh = makeShell();
    expect(sh.run("printf 'a:b:c\\n' | cut -d: -f2").stdout).toBe("b\n");
    expect(sh.run("printf 'a:b:c\\n' | cut -d: -f1,3").stdout).toBe("a:c\n");
    expect(sh.run("printf 'hello\\n' | cut -c1-3").stdout).toBe("hel\n");
  });
  it("tr translates and deletes", () => {
    const sh = makeShell();
    expect(sh.run("printf 'abc\\n' | tr a-z A-Z").stdout).toBe("ABC\n");
    expect(sh.run("printf 'a1b2\\n' | tr -d 0-9").stdout).toBe("ab\n");
  });
  it("uniq -c counts adjacent runs", () => {
    expect(makeShell().run("printf 'a\\na\\nb\\n' | uniq -c").stdout).toBe("      2 a\n      1 b\n");
  });
  it("tac reverses line order and rev reverses characters", () => {
    const sh = makeShell();
    expect(sh.run("printf '1\\n2\\n3\\n' | tac").stdout).toBe("3\n2\n1\n");
    expect(sh.run("printf 'abc\\n' | rev").stdout).toBe("cba\n");
  });
  it("seq counts with an optional step", () => {
    const sh = makeShell();
    expect(sh.run("seq 3").stdout).toBe("1\n2\n3\n");
    expect(sh.run("seq 2 6").stdout).toBe("2\n3\n4\n5\n6\n");
    expect(sh.run("seq 1 2 7").stdout).toBe("1\n3\n5\n7\n");
  });
});

describe("path-string commands", () => {
  it("basename strips directories and a suffix", () => {
    const sh = makeShell();
    expect(sh.run("basename /usr/lib/file.txt").stdout).toBe("file.txt\n");
    expect(sh.run("basename /usr/lib/file.txt .txt").stdout).toBe("file\n");
  });
  it("dirname strips the last component", () => {
    const sh = makeShell();
    expect(sh.run("dirname /usr/lib/file.txt").stdout).toBe("/usr/lib\n");
    expect(sh.run("dirname file").stdout).toBe(".\n");
  });
});

describe("find and tree", () => {
  it("find filters by -name and -type", () => {
    const sh = makeShell();
    sh.run("mkdir -p proj/sub");
    sh.run("echo x > proj/a.md");
    sh.run("echo y > proj/sub/b.md");
    expect(sh.run("find proj -name '*.md'").stdout).toBe("proj/a.md\nproj/sub/b.md\n");
    expect(sh.run("find proj -type d").stdout).toBe("proj\nproj/sub\n");
  });
  it("tree renders connectors and a summary", () => {
    const sh = makeShell();
    sh.run("mkdir -p t/d");
    sh.run("echo x > t/f");
    const out = sh.run("tree t").stdout;
    expect(out).toContain("├── ");
    expect(out).toContain("└── ");
    expect(out.trim().endsWith("1 directory, 1 file")).toBe(true);
  });
});

describe("system identity", () => {
  it("uname reports kernel and machine", () => {
    const sh = makeShell();
    expect(sh.run("uname").stdout).toBe("Linux\n");
    expect(sh.run("uname -m").stdout).toBe("x86_64\n");
    expect(sh.run("uname -s -r").stdout).toBe("Linux 6.8.0-generic\n");
  });
  it("hostname comes from the data island", () => {
    expect(makeShell().run("hostname").stdout).toBe("example.com\n");
  });
  it("cal has the expected shape (nondeterministic content)", () => {
    const lines = makeShell().run("cal").stdout.split("\n");
    expect(lines[1]).toBe("Su Mo Tu We Th Fr Sa");
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

describe("command resolution agrees with the filesystem", () => {
  it("which prints a path that actually exists and is executable", () => {
    const sh = makeShell();
    expect(sh.run("which ls").stdout).toBe("/usr/bin/ls\n");
    // The advertised path resolves in the VFS -- the inconsistency this fixes.
    expect(sh.run("ls /usr/bin/ls").stdout).toBe("/usr/bin/ls\n");
    expect(sh.run('[ -x "$(which ls)" ] && echo ok').stdout).toBe("ok\n");
  });
  it("which honors $PATH order and an explicit path", () => {
    const sh = makeShell();
    expect(sh.run("which bash").stdout).toBe("/bin/bash\n");
    expect(sh.run("which ./posts").status).toBe(1); // not executable
    expect(sh.run("which /bin/bash").stdout).toBe("/bin/bash\n");
  });
  it("which stays silent and fails for builtins, aliases, and unknowns", () => {
    const sh = makeShell();
    for (const name of ["cd", "ll", "frobnicate"]) {
      const r = sh.run(`which ${name}`);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe("");
      expect(r.status).toBe(1);
    }
  });
  it("type distinguishes builtins, externals, and aliases consistently", () => {
    const sh = makeShell();
    expect(sh.run("type cd").stdout).toBe("cd is a shell builtin\n");
    expect(sh.run("type ls").stdout).toBe("ls is /usr/bin/ls\n");
    expect(sh.run("type ll").stdout).toBe("ll is aliased to `ls -la'\n");
    const miss = sh.run("type frobnicate");
    expect(miss.stderr).toBe("bash: type: frobnicate: not found\n");
    expect(miss.status).toBe(1);
  });
  it("the PATH dirs the shell advertises are real directories", () => {
    const sh = makeShell();
    expect(sh.run("[ -d /usr/bin ] && [ -d /bin ] && echo ok").stdout).toBe("ok\n");
  });
});
