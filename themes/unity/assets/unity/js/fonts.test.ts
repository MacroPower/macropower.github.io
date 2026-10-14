import { afterEach, describe, expect, it, vi } from "vitest";

import { MONO_STACK, monoFamily } from "./fonts";
import { css as stylesheet, siteTokens } from "./testkit";

// main.css without its @font-face blocks, which name the faces rather
// than pick a family for an element.
const css = stylesheet.replace(/@font-face\s*\{[^}]*\}/g, "");

const stack = (value: string): string => value.trim().replace(/\s*,\s*/g, ",");

describe("font tokens", () => {
  const token = (name: string): string => stack(siteTokens.get(`--up-font-${name}`) ?? "");

  it("defines both stacks on :root", () => {
    expect(token("sans")).toMatch(/^"Ubuntu",/);
    expect(token("mono")).toMatch(/^"Ubuntu Mono",/);
  });

  it("keeps the scripts' fallback equal to the :root mono stack", () => {
    expect(stack(MONO_STACK)).toBe(token("mono"));
  });

  it("names every family through a token", () => {
    const strays = [...css.matchAll(/(?<![\w-])font(-family)?\s*:\s*([^;}]+)/g)]
      .map((m) => ({ shorthand: !m[1], value: m[2]!.trim() }))
      .filter(({ shorthand, value }) =>
        value !== "inherit" && !(shorthand ? /\svar\(--up-font-(?:sans|mono)\)$/ : /^var\(--up-font-(?:sans|mono)\)$/).test(value))
      .map(({ value }) => value);
    // The vendored xterm block's accessibility tree, and MathML, which the
    // Ubuntu faces cannot render.
    expect(strays).toEqual(["monospace", 'math,"STIX Two Math","Cambria Math","Latin Modern Math",serif']);
  });
});

describe("monoFamily", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const style = (value: string): void => {
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (name: string) => (name === "--up-font-mono" ? value : ""),
    }));
  };

  it("reads the token at the element", () => {
    style(' "Fira Mono", monospace ');
    expect(monoFamily({} as Element)).toBe('"Fira Mono", monospace');
  });

  it("falls back to the default stack when the token is empty", () => {
    style("");
    expect(monoFamily({} as Element)).toBe(MONO_STACK);
  });
});
