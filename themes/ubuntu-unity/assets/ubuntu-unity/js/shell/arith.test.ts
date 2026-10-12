import { describe, it, expect } from "vitest";
import { evalArith } from "./arith";

const noVars = (): string => "";

describe("evalArith", () => {
  const cases: [string, number][] = [
    ["2+3*4", 14],
    ["(2+3)*4", 20],
    ["2**10", 1024],
    ["2**3**2", 512], // right-associative
    ["7/2", 3],
    ["-7/2", -3], // truncate toward zero
    ["7%3", 1],
    ["1<<4", 16],
    ["256>>2", 64],
    ["6 & 3", 2],
    ["6 | 1", 7],
    ["5 ^ 1", 4],
    ["~0", -1],
    ["!0", 1],
    ["!5", 0],
    ["3>2", 1],
    ["2>3", 0],
    ["3>=3", 1],
    ["2==2", 1],
    ["2!=2", 0],
    ["1 && 0", 0],
    ["1 || 0", 1],
    ["5>3?10:20", 10],
    ["5<3?10:20", 20],
    ["1,2,3", 3], // comma yields last
    ["-(3+4)", -7],
    ["+5", 5],
  ];
  for (const [expr, want] of cases) {
    it(`${expr} = ${want}`, () => { expect(evalArith(expr, noVars)).toBe(want); });
  }

  it("resolves bare identifiers through lookup", () => {
    const vars: Record<string, string> = { X: "5", Y: "3" };
    expect(evalArith("X*Y", (n) => vars[n] ?? "")).toBe(15);
  });

  it("treats unset identifiers as 0", () => {
    expect(evalArith("NOPE + 1", noVars)).toBe(1);
  });

  it("evaluates an identifier's value recursively", () => {
    const vars: Record<string, string> = { A: "B+1", B: "10" };
    expect(evalArith("A", (n) => vars[n] ?? "")).toBe(11);
  });

  it("parses hex and octal literals", () => {
    expect(evalArith("0xff", noVars)).toBe(255);
    expect(evalArith("010", noVars)).toBe(8);
  });

  it("throws on division by zero", () => {
    expect(() => evalArith("1/0", noVars)).toThrow();
  });

  it("throws on malformed expressions", () => {
    expect(() => evalArith("1 +", noVars)).toThrow();
    expect(() => evalArith("@", noVars)).toThrow();
  });
});
