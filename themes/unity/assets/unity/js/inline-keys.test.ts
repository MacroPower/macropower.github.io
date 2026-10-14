// Checks for the Left and Right arrow keys in inline-keys.ts. A row
// steps forward on the key that points toward the end of its line.

import { afterEach, describe, expect, it, vi } from "vitest";

import { inlineDirection, inlineStep } from "./inline-keys";

describe("inlineStep", () => {
  it("steps forward on Right in a left-to-right row", () => {
    expect(inlineStep("ArrowRight", "ltr")).toBe(1);
    expect(inlineStep("ArrowLeft", "ltr")).toBe(-1);
  });

  it("steps forward on Left in a right-to-left row", () => {
    expect(inlineStep("ArrowLeft", "rtl")).toBe(1);
    expect(inlineStep("ArrowRight", "rtl")).toBe(-1);
  });
});

describe("inlineDirection", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("reads the element's computed direction", () => {
    const el = {} as Element;
    for (const direction of ["rtl", "ltr"] as const) {
      vi.stubGlobal("getComputedStyle", (target: Element) => ({ direction: target === el ? direction : "" }));
      expect(inlineDirection(el)).toBe(direction);
    }
  });

  it("falls back to left to right on any other value", () => {
    vi.stubGlobal("getComputedStyle", () => ({ direction: "" }));
    expect(inlineDirection({} as Element)).toBe("ltr");
  });
});
