import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { declarations } from "./testkit";

const layouts = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "layouts");

// Each rule's own declarations, keyed by the selectors of the rules
// around it, such as "@media (scripting: none) .up-shell".
const rules = new Map<string, Map<string, string>>();
for (const { path, prop, value } of declarations) {
  if (!rules.has(path)) rules.set(path, new Map());
  rules.get(path)!.set(prop, value);
}

// The first value main.css gives each custom property.
const props = new Map<string, string>();
for (const decls of rules.values()) {
  for (const [name, value] of decls) if (name.startsWith("--") && !props.has(name)) props.set(name, value);
}

// The first mostly opaque color in a background value, after var()
// resolves, as sRGB channels from 0 to 255. A gradient yields its first
// such stop, and color-mix() its first color. A faint pattern over a
// light fill, such as the projects grid's dots, falls through to the
// fill.
function firstColor(value: string): number[] | undefined {
  let v = value;
  for (let depth = 0; depth < 4; depth++) v = v.replace(/var\((--[\w-]+)\)/g, (_, name: string) => props.get(name) ?? "");
  for (const m of v.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b|rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?/gi)) {
    if (!m[1]) {
      if (Number(m[5] ?? 1) >= 0.5) return [m[2], m[3], m[4]].map(Number);
      continue;
    }
    const hex = m[1].length === 3 ? [...m[1]].map((h) => h + h).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  return undefined;
}

// A background is dark when its relative luminance is less than 0.179,
// the point where white text starts to contrast with it more than black
// text does.
function isDark(rgb: number[]): boolean {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 0.179;
}

const background = (decls: Map<string, string>): number[] | undefined =>
  firstColor(decls.get("background") ?? decls.get("background-color") ?? "");

describe("color-scheme", () => {
  it("declares the dark scheme on every scroller that paints a dark background", () => {
    const light = [...rules]
      .filter(([, decls]) =>
        ["overflow", "overflow-x", "overflow-y"].some((p) => /\b(auto|scroll)\b/.test(decls.get(p) ?? "")))
      .filter(([, decls]) => {
        const bg = background(decls);
        return bg && isDark(bg) && decls.get("color-scheme") !== "dark";
      })
      .map(([rule]) => rule);
    expect(light).toEqual([
      // The site's markup.highlight.style paints a highlighted code block,
      // so the block might be light.
      ":is(.up-reader-body, .up-page-body) pre",
      // It inherits the scheme from .up-daw-body.
      ".up-daw-rack",
    ]);
  });

  it("declares only the dark scheme, and only over a dark background", () => {
    const declared = [...rules].filter(([, decls]) => decls.has("color-scheme"));
    expect(declared.length).toBeGreaterThan(0);
    const wrong = declared
      .filter(([, decls]) => {
        const bg = background(decls);
        return decls.get("color-scheme") !== "dark" || (bg !== undefined && !isDark(bg));
      })
      .map(([rule]) => rule);
    expect(wrong).toEqual([]);
  });

  it("draws the parts of every range slider itself", () => {
    // Chrome picks a native range's trough color from accent-color, not
    // from color-scheme, so a native slider can draw a light trough on a
    // dark surface. Each engine draws the parts that main.css styles only
    // after the slider drops its native appearance.
    const sliders = readdirSync(layouts, { encoding: "utf8", recursive: true })
      .filter((f) => f.endsWith(".html"))
      .flatMap((f) => [...readFileSync(join(layouts, f), "utf8").matchAll(/<input\b[^>]*\btype="range"[^>]*>/g)]
        .map((m) => /\bclass="([\w-]+)/.exec(m[0])?.[1] ?? `a range without a class in ${f}`));
    expect(sliders).toContain("up-vol-slider");
    const parts = [
      "::-webkit-slider-runnable-track", "::-webkit-slider-thumb",
      "::-moz-range-track", "::-moz-range-progress", "::-moz-range-thumb",
    ];
    const native = sliders.flatMap((name) => [
      ...(rules.get(`.${name}`)?.get("appearance") === "none" ? [] : [`.${name} keeps its native appearance`]),
      ...parts.filter((part) => !rules.has(`.${name} &${part}`)).map((part) => `.${name}${part} has no rule`),
    ]);
    expect(native).toEqual([]);
  });

  it("leaves the colors of highlighted code to the highlight style", () => {
    // A highlight style that does not set a text or background color
    // expects the page's, so the theme's code colors must not reach a
    // block that Hugo highlights.
    const prose = ":is(.up-reader-body, .up-page-body)";
    const block = rules.get(`${prose} .highlight pre`);
    expect([block?.get("color"), block?.get("background")]).toEqual(["inherit", "transparent"]);
    const painted = [...rules]
      .filter(([rule, decls]) => rule.startsWith(`${prose} `) && /\bcode\b/.test(rule) && (decls.get("color") ?? "inherit") !== "inherit")
      .map(([rule]) => rule);
    expect(painted).toEqual([]);
  });
});
