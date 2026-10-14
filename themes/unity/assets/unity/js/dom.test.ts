// Checks for requireAll in dom.ts. The suite runs under Node without a
// DOM, so plain objects stand in for the elements that a module looks up.
// The type checks make `npm run typecheck:test` fail when the result's
// fields widen back to nullable types.

import { describe, expect, expectTypeOf, it } from "vitest";

import { requireAll } from "./dom";

interface Stub {
  readonly name: string;
}

const roll: Stub = { name: "roll" };
const canvas: Stub = { name: "canvas" };

describe("requireAll", () => {
  it("returns the lookups when every one is present", () => {
    const lookups = { roll, canvas };
    expect(requireAll(lookups)).toBe(lookups);
  });

  it("returns null when a lookup is null", () => {
    expect(requireAll({ roll, canvas: null })).toBeNull();
  });

  it("returns null when a lookup is undefined", () => {
    expect(requireAll({ roll, canvas: undefined })).toBeNull();
  });

  it("keeps falsy values that are not null or undefined", () => {
    const lookups = { count: 0, label: "", off: false };
    expect(requireAll(lookups)).toBe(lookups);
  });

  it("types each field without null", () => {
    const lookup = (found: boolean): Stub | null => (found ? roll : null);
    const els = requireAll({ roll: lookup(true), canvas: lookup(true) });
    expectTypeOf(els).toEqualTypeOf<{ roll: Stub; canvas: Stub } | null>();
    if (!els) throw new Error("unreachable: both lookups found a node");
    const { roll: r } = els;
    // A function declaration keeps the const's non-null type, where a
    // guard's narrowing of a nullable const would not reach it.
    function name(): string {
      return r.name;
    }
    expect(name()).toBe("roll");
  });
});
