import { describe, it, expect } from "vitest";
import { parse, tokenizeWords, type SimpleCommand, type WordPart } from "./parse";

const env = { home: "/home/me" };
const p = (line: string) => parse(line, env);
const firstCmd = (line: string): SimpleCommand => {
  const c = p(line).statements[0]?.pipeline[0];
  if (!c) throw new Error(`no command in: ${line}`);
  return c;
};
// Literal text of a word built only from {lit} parts.
const litOf = (parts: WordPart[]): string =>
  parts.map((x) => ("lit" in x ? x.lit : "")).join("");

describe("statements and connectors", () => {
  it("splits on ; && ||", () => {
    const r = p("a && b || c ; d");
    expect(r.statements.map((s) => s.connector)).toEqual([";", "&&", "||", ";"]);
  });
  it("builds pipelines", () => {
    const cmd = p("a | b | c").statements[0];
    expect(cmd?.pipeline).toHaveLength(3);
  });
  it("reports a syntax error for a dangling pipe", () => {
    expect(p("| foo").error).toMatch(/syntax error/);
  });
  it("treats # as a comment", () => {
    expect(firstCmd("echo hi # tail").words.map((w) => litOf(w.parts))).toEqual(["echo", "hi"]);
  });
});

describe("quoting, escapes, tilde", () => {
  it("expands ~ at the start of a word", () => {
    expect(litOf(firstCmd("cd ~/x").words[1]!.parts)).toBe("/home/me/x");
  });
  it("keeps ~ mid-word literal", () => {
    expect(litOf(firstCmd("echo a~b").words[1]!.parts)).toBe("a~b");
  });
  it("single quotes are literal", () => {
    const w = firstCmd("echo '$X \\n'").words[1]!;
    expect(w.parts).toEqual([{ lit: "$X \\n" }]);
  });
  it("backslash escapes the next char", () => {
    expect(litOf(firstCmd("echo a\\ b").words[1]!.parts)).toBe("a b");
  });
  it("flags an unterminated quote", () => {
    expect(p('echo "oops').error).toMatch(/EOF/);
  });
});

describe("word parts left for runtime", () => {
  it("captures $VAR and ${VAR} as param parts", () => {
    expect(firstCmd("echo $X").words[1]!.parts).toEqual([{ param: "X" }]);
    expect(firstCmd("echo ${X}").words[1]!.parts).toEqual([{ param: "X" }]);
  });
  it("captures $(( )) as an arith part", () => {
    const part = firstCmd("echo $((1+2))").words[1]!.parts[0]!;
    expect("arith" in part && part.arith).toBe("1+2");
  });
  it("captures $(...) as a cmdsub part with a parsed inner program", () => {
    const part = firstCmd("echo $(echo hi)").words[1]!.parts[0]!;
    expect("cmdsub" in part).toBe(true);
    if ("cmdsub" in part) {
      expect(part.cmdsub.statements[0]?.pipeline[0]?.words.map((w) => litOf(w.parts))).toEqual(["echo", "hi"]);
    }
  });
  it("captures backtick substitution", () => {
    const part = firstCmd("echo `whoami`").words[1]!.parts[0]!;
    expect("cmdsub" in part).toBe(true);
  });
  it("captures ${VAR:-word} as a paramExpr", () => {
    const part = firstCmd("echo ${X:-def}").words[1]!.parts[0]!;
    expect("paramExpr" in part && part.paramExpr.op).toBe(":-");
    if ("paramExpr" in part) expect(litOf(part.paramExpr.word.parts)).toBe("def");
  });
  it("marks parts inside double quotes as quoted", () => {
    const part = firstCmd('echo "$X"').words[1]!.parts[0]!;
    expect("param" in part && part.quoted).toBe(true);
  });
});

describe("glob flag", () => {
  it("sets hasUnquotedGlob for unquoted metacharacters", () => {
    expect(firstCmd("ls *.md").words[1]!.hasUnquotedGlob).toBe(true);
    expect(firstCmd("ls a?.md").words[1]!.hasUnquotedGlob).toBe(true);
    expect(firstCmd("ls [ab]x").words[1]!.hasUnquotedGlob).toBe(true);
  });
  it("does not set the flag for quoted metacharacters", () => {
    expect(firstCmd("echo '*'").words[1]!.hasUnquotedGlob).toBe(false);
    expect(firstCmd('echo "*"').words[1]!.hasUnquotedGlob).toBe(false);
  });
});

describe("redirections", () => {
  it("parses a simple > target", () => {
    expect(firstCmd("echo hi > out").redirs).toEqual([
      { kind: "file", fd: 1, op: ">", target: expect.anything() },
    ]);
  });
  it("parses >> append", () => {
    expect(firstCmd("echo hi >> out").redirs[0]).toMatchObject({ fd: 1, op: ">>" });
  });
  it("parses an fd prefix (2>) and fd append (2>>)", () => {
    expect(firstCmd("cmd 2> err").redirs[0]).toMatchObject({ kind: "file", fd: 2, op: ">" });
    expect(firstCmd("cmd 2>> err").redirs[0]).toMatchObject({ kind: "file", fd: 2, op: ">>" });
  });
  it("expands &>> into an appending file plus a 2>&1 dup", () => {
    expect(firstCmd("cmd &>> out").redirs).toEqual([
      { kind: "file", fd: 1, op: ">>", target: expect.anything() },
      { kind: "dup", fd: 2, toFd: 1 },
    ]);
  });
  it("parses dup redirections 2>&1 and 1>&2", () => {
    expect(firstCmd("cmd 2>&1").redirs[0]).toEqual({ kind: "dup", fd: 2, toFd: 1 });
    expect(firstCmd("cmd 1>&2").redirs[0]).toEqual({ kind: "dup", fd: 1, toFd: 2 });
    expect(firstCmd("cmd >&2").redirs[0]).toEqual({ kind: "dup", fd: 1, toFd: 2 });
  });
  it("expands &> into a file plus a 2>&1 dup", () => {
    expect(firstCmd("cmd &> out").redirs).toEqual([
      { kind: "file", fd: 1, op: ">", target: expect.anything() },
      { kind: "dup", fd: 2, toFd: 1 },
    ]);
  });
});

describe("tokenizeWords", () => {
  it("returns only words, dropping operators", () => {
    const ws = tokenizeWords("ls -la | wc", env);
    expect(ws.map((w) => litOf(w.parts))).toEqual(["ls", "-la", "wc"]);
  });
});
