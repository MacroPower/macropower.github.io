import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { MONO_STACK, monoFamily } from "./fonts";

const here = dirname(fileURLToPath(import.meta.url));

// main.css without its comments and @font-face blocks, which name the
// faces rather than pick a family for an element.
const css = readFileSync(join(here, "..", "css", "main.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@font-face\s*\{[^}]*\}/g, "");

const stack = (value: string): string => value.trim().replace(/\s*,\s*/g, ",");

describe("font tokens", () => {
  const root = /^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
  const token = (name: string): string => stack(new RegExp(`--up-font-${name}\\s*:([^;]+);`).exec(root)?.[1] ?? "");

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
