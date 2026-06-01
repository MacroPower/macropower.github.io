import { describe, it, expect } from "vitest";
import { parse } from "./parse";
import { expandFields, expandNoSplit, type Expander } from "./shell";
import { evalArith } from "./arith";

function fakeExpander(vars: Record<string, string>): Expander {
  return {
    lookup: (n) => vars[n] ?? "",
    isSet: (n) => Object.prototype.hasOwnProperty.call(vars, n),
    assign: (n, v) => { vars[n] = v; },
    runSub: () => "SUB",
    arith: (e) => evalArith(e, (n) => vars[n] ?? ""),
    error: () => { /* swallow */ },
  };
}

// Field-expand every word of a single command line.
function fields(line: string, vars: Record<string, string> = {}): string[] {
  const cmd = parse(line, { home: "/home/me" }).statements[0]?.pipeline[0];
  if (!cmd) return [];
  const exp = fakeExpander(vars);
  return cmd.words.flatMap((w) => expandFields(w, exp));
}

describe("word splitting", () => {
  it("splits unquoted expansions on IFS whitespace", () => {
    expect(fields("e $X", { X: "a b c" })).toEqual(["e", "a", "b", "c"]);
  });
  it("collapses runs and trims leading/trailing whitespace", () => {
    expect(fields("e $X", { X: "  a   b  " })).toEqual(["e", "a", "b"]);
  });
  it("does not split quoted expansions", () => {
    expect(fields('e "$X"', { X: "a b c" })).toEqual(["e", "a b c"]);
  });
  it("drops a bare unquoted empty expansion (null word)", () => {
    expect(fields("e $X end", { X: "" })).toEqual(["e", "end"]);
  });
  it("keeps a quoted empty expansion as one field", () => {
    expect(fields('e "$X" end', { X: "" })).toEqual(["e", "", "end"]);
  });
  it("keeps literal empty quotes as one field", () => {
    expect(fields("e '' end")).toEqual(["e", "", "end"]);
  });
  it("concatenates adjacent literal and expansion", () => {
    expect(fields("e x$X", { X: "y z" })).toEqual(["e", "xy", "z"]);
  });
});

describe("parameter expansion", () => {
  const one = (line: string, vars: Record<string, string> = {}): string | undefined =>
    fields(line, vars)[1];

  it(":- uses default when unset or null", () => {
    expect(one("e ${X:-def}", {})).toBe("def");
    expect(one("e ${X:-def}", { X: "" })).toBe("def");
    expect(one("e ${X:-def}", { X: "v" })).toBe("v");
  });
  it("- uses default only when unset", () => {
    expect(one("e ${X-def}", {})).toBe("def");
    expect(fields("e ${X-def}", { X: "" })).toEqual(["e"]); // set-null -> empty -> dropped
  });
  it(":+ yields the alternate only when set and non-null", () => {
    expect(one("e ${X:+alt}", { X: "v" })).toBe("alt");
    expect(fields("e ${X:+alt}", { X: "" })).toEqual(["e"]);
    expect(fields("e ${X:+alt}", {})).toEqual(["e"]);
  });
  it("${#VAR} is the length", () => {
    expect(one("e ${#X}", { X: "abcde" })).toBe("5");
  });
  it("# / ## strip a prefix glob (shortest / longest)", () => {
    expect(one("e ${X#a}", { X: "abc" })).toBe("bc");
    expect(one("e ${X#*/}", { X: "a/b/c" })).toBe("b/c");
    expect(one("e ${X##*/}", { X: "a/b/c" })).toBe("c");
  });
  it("% / %% strip a suffix glob (shortest / longest)", () => {
    expect(one("e ${X%c}", { X: "abc" })).toBe("ab");
    expect(one("e ${X%/*}", { X: "a/b/c" })).toBe("a/b");
    expect(one("e ${X%%/*}", { X: "a/b/c" })).toBe("a");
  });
  it(":= assigns the default and returns it", () => {
    const vars: Record<string, string> = {};
    expect(one("e ${X:=def}", vars)).toBe("def");
    expect(vars.X).toBe("def");
  });
});

describe("expandNoSplit", () => {
  it("joins parts without splitting", () => {
    const cmd = parse("x=$Y", { home: "/home/me" }).statements[0]?.pipeline[0];
    const word = cmd?.words[0];
    expect(word && expandNoSplit(word, fakeExpander({ Y: "a b" }))).toBe("x=a b");
  });
});
