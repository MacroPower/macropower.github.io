// Differential tests: the same program is run through our shell and through
// real bash, asserting stdout and exit status agree. Auto-skips when bash is
// absent. Only commands that are not TTY-format-sensitive appear here (echo,
// printf, test/[, true/false, arithmetic, cat/wc -l on stdin); ls/grep -n
// columns, globbing, and multi-column wc are JS-only golden tests elsewhere.

import { describe, it } from "vitest";
import { bashAvailable, expectMatchesBash, makeShell, runBash } from "./testkit";
import { expect } from "vitest";

const R = String.raw;

const ROWS: string[] = [
  // --- Phase 0: behavior that already matched bash --------------------------
  "echo a b c",
  "echo a    b   c",
  "echo 'a  b' c",
  R`echo "a b" c`,
  "echo",
  "true; echo $?",
  "false; echo $?",
  "true && echo yes",
  "false || echo no",
  "false && echo nope",
  "true || echo nope",
  "X=hi; echo $X",
  "echo $UNSET end",
  "echo a; echo b",
  "echo one | cat",
  R`echo "\$HOME stays literal"`,

  // --- Phase 1: command substitution, arithmetic, parameter expansion -------
  "echo $(echo hi)",
  "echo $(echo a; echo b)",
  R`echo "$(printf 'a\nb')"`,
  "echo a$(echo b)c",
  "echo `echo backtick`",
  R`echo "x\`echo hi\`y"`,
  "echo $((2+3*4))",
  "echo $((2**10))",
  "echo $((7/2)) $((7%2)) $((-7/2))",
  "echo $((1<<4 | 1))",
  "echo $((3>2)) $((3<2))",
  "echo $((1 && 0)) $((1 || 0))",
  "echo $((5>3?10:20))",
  "echo $(( (1+2) * 3 ))",
  "X=5; echo $((X*2))",
  "X=; echo ${X:-def}",
  "echo ${X:+set}",
  "X=hi; echo ${X:+set}",
  "Y=abcdef; echo ${#Y} ${Y#a} ${Y%f}",
  "Y=abcabc; echo ${Y#a*c} ${Y##a*c}",
  "Y=abcabc; echo ${Y%a*c} ${Y%%a*c}",
  "P=path/to/file; echo ${P#*/} ${P##*/}",
  "echo ${UNSET:-fallback}",
  "echo ${UNSET-fallback}",
  "U=; echo ${U-x} ${U:-y}",
  "X=def; echo ${UNSET:=$X}",
  // word splitting
  R`x='a b c'; printf '[%s]' $x`,
  R`x='a b c'; printf '[%s]' "$x"`,
  R`printf '[%s]' $(echo)`,
  "echo a   $UNSET   b",
  // subshell isolation of variable assignments
  "X=1; echo $(X=2); echo $X",
  "false; echo $(true); echo $?",

  // --- Phase 3: stderr + redirections ---------------------------------------
  "false 2>/dev/null; echo $?",
  "echo hi 2>&1 | cat",
  "cat nope.txt 2>/dev/null | wc -l",
  "echo out 1>&2 2>/dev/null; echo done",

  // --- Phase 4: POSIX builtins ----------------------------------------------
  ": ; echo $?",
  R`printf '%s-%d\n' a 1 b 2`,
  R`printf '%s\n' a b c`,
  R`printf '%05d|%-5s|%5s\n' 42 hi yo`,
  R`printf '%x %o\n' 255 8`,
  "[ -n x ] && echo y",
  R`[ -z "" ] && echo y`,
  R`test -z "" && echo empty`,
  "[ 3 -gt 2 ] && echo y",
  "[ 2 -gt 3 ] || echo n",
  "[ abc = abc ] && echo y",
  "[ abc != xyz ] && echo y",
  "[ ! -z x ] && echo y",
  "[ 1 -eq 1 -a 2 -eq 2 ] && echo y",
  "[ 1 -eq 2 -o 2 -eq 2 ] && echo y",
  R`echo -e 'a\tb'`,
  R`echo -E 'a\tb'`,
  R`echo 'a\tb'`,
  "echo -n hi; echo .",
  R`echo -ne 'a\tb'; echo .`,
  "echo -nx hi",
  "echo -x hi",

  // --- Phase 5: pure stdin/arg coreutils filters ----------------------------
  // These resolve to host coreutils (GNU on the dev/CI image); rows are kept to
  // behaviors identical across coreutils variants.
  R`printf 'a:b:c\n' | cut -d: -f2`,
  R`printf 'a:b:c\n' | cut -d: -f1,3`,
  R`printf 'a:b:c:d\n' | cut -d: -f2-`,
  R`printf 'hello\n' | cut -c1-3`,
  R`printf 'abc\n' | tr a-z A-Z`,
  R`printf 'a1b2c3\n' | tr -d 0-9`,
  R`printf 'a\na\nb\nb\nb\nc\n' | uniq`,
  R`printf 'a\na\nb\n' | uniq -c`,
  R`printf 'hello\n' | rev`,
  R`printf '1\n2\n3\n' | tac`,
  "seq 5",
  "seq 2 6",
  "seq 1 2 9",
  "basename /usr/lib/file.txt",
  "basename /usr/lib/file.txt .txt",
  "basename path/to/file",
  "dirname /usr/lib/file.txt",
  "dirname file",
];

describe.skipIf(!bashAvailable())("bash conformance", () => {
  for (const row of ROWS) {
    it(row, () => { expectMatchesBash(row); });
  }
});

// The harness must never spawn a filesystem-mutating program against the real
// host (FS-mutating behavior is covered by in-memory makeShell tests). This
// guard runs regardless of bash availability -- it throws before any spawn.
describe("runBash refuses to mutate the host filesystem", () => {
  for (const danger of ["rm -rf /", "rm -rf --no-preserve-root /", "mkdir x", "touch y", "echo hi | tee z"]) {
    it(`rejects: ${danger}`, () => {
      expect(() => runBash(danger)).toThrow(/filesystem-mutating/);
    });
  }
});

// Nondeterministic / DOM-bound parameters are asserted in isolation, never
// diffed against bash.
describe("nondeterministic params (JS-only)", () => {
  it("$$ is a stable positive integer", () => {
    const sh = makeShell();
    const a = sh.run("echo $$").stdout.trim();
    const b = sh.run("echo $$").stdout.trim();
    expect(a).toBe(b);
    expect(Number(a)).toBeGreaterThan(0);
  });

  it("$RANDOM is within range", () => {
    const sh = makeShell();
    const v = Number(sh.run("echo $RANDOM").stdout.trim());
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(32768);
  });
});
