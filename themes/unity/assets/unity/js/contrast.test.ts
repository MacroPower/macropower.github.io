import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

// main.css without its comments.
const css = readFileSync(join(here, "..", "css", "main.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Splits a selector list at its top-level commas.
function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

interface Rule {
  selector: string;
  // The at-rules around the rule, joined, such as "@media print".
  media: string;
  decls: Map<string, string>;
}

// Every rule in source order, one entry per selector, with nesting
// resolved, so `.up-post-row { &.is-active {} }` yields
// ".up-post-row.is-active".
const rules: Rule[] = [];
{
  const open: { selectors: string[]; media: string }[] = [];
  const own: Map<string, string>[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c !== "{" && c !== ";" && c !== "}") continue;
    const text = css.slice(start, i).trim().replace(/\s+/g, " ");
    start = i + 1;
    if (c === "{") {
      const parents = open.at(-1)?.selectors ?? [];
      let media = open.at(-1)?.media ?? "";
      let selectors: string[];
      if (text.startsWith("@")) {
        selectors = parents;
        media = `${media} ${text}`.trim();
      } else if (parents.length === 0) selectors = splitList(text);
      else {
        selectors = parents.flatMap((p) =>
          splitList(text).map((s) => (s.includes("&") ? s.replaceAll("&", p) : `${p} ${s}`)));
      }
      const decls = new Map<string, string>();
      open.push({ selectors, media });
      own.push(decls);
      for (const selector of selectors) rules.push({ selector, media, decls });
      continue;
    }
    const m = /^([\w-]+)\s*:([\s\S]+)$/.exec(text);
    if (m) own.at(-1)?.set(m[1]!, m[2]!.trim());
    if (c === "}") {
      open.pop();
      own.pop();
    }
  }
}

const isForced = (r: Rule): boolean => r.media.includes("forced-colors: active");
// The rules a screen draws.
const screen = rules.filter((r) => !isForced(r) && !r.media.includes("print"));

// WCAG relative luminance of an [r, g, b] color in 0-255.
function luminance(rgb: number[]): number {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

// The color `top` at the given opacity over `under`, both in 0-255.
function over(top: number[], alpha: number, under: number[]): number[] {
  return top.map((v, i) => v * alpha + under[i]! * (1 - alpha));
}

const WHITE = [255, 255, 255];

// The opacity of a white text color, or undefined for any other color.
function whiteAlpha(color: string | undefined): number | undefined {
  if (color === undefined) return undefined;
  if (/^(#fff|#ffffff|white)$/i.test(color)) return 1;
  const m = /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([\d.]+)\s*\)$/.exec(color);
  return m ? Number(m[1]) : undefined;
}

const fill = (r: Rule): string | undefined =>
  r.decls.get("background") ?? r.decls.get("background-color") ?? r.decls.get("background-image");

describe("contrast", () => {
  it("keeps every alert title at 4.5:1 on its bar", () => {
    const base = screen.find((r) => r.selector === ".up-alert");
    expect(base).toBeDefined();
    // The bar's gradient starts at its color mixed with white.
    const top = Number(/var\(--up-alert-bg\) (\d+)%, #fff\)/.exec(fill(base!) ?? "")?.[1] ?? 100) / 100;
    const kinds = screen.filter((r) => /^\.up-alert(\.is-[\w-]+)?$/.test(r.selector) && r.decls.has("--up-alert-ink"));
    expect(kinds.map((r) => r.selector)).toEqual(expect.arrayContaining([".up-alert", ".up-alert.is-tip"]));
    const low = kinds.flatMap((r) => {
      const ink = rgb(r.decls.get("--up-alert-ink")!);
      const bg = rgb(r.decls.get("--up-alert-bg")!);
      return [bg, over(bg, top, WHITE)]
        .filter((under) => contrast(ink, under) < 4.5)
        .map((under) => `${r.selector} on ${under.map(Math.round).join(",")}`);
    });
    expect(low).toEqual([]);
  });

  it("keeps live white text at half opacity or more", () => {
    // White text at half opacity keeps 4.5:1 on the theme's dark
    // surfaces. WCAG exempts each of these.
    const skip = new Map([
      // The wallpaper's watermark is decoration.
      [".up-desktop-label", "decoration"],
      // The empty and filled circles mark a row's state, and a mark
      // needs only 3:1, which .4 keeps on a menu.
      [".up-net-row-dot", "mark"],
      [".up-lang-row::before", "mark"],
    ]);
    const dim = screen
      .filter((r) => (whiteAlpha(r.decls.get("color")) ?? 1) < 0.5)
      .map((r) => r.selector)
      // WCAG exempts every disabled control.
      .filter((s) => !s.includes(".is-disabled"));
    expect(dim).toEqual(expect.arrayContaining([...skip.keys()]));
    expect(dim.filter((s) => !skip.has(s))).toEqual([]);
  });
});
