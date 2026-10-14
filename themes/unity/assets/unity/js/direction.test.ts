import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { css, rules } from "./testkit";

const here = dirname(fileURLToPath(import.meta.url));
const layouts = join(here, "..", "..", "..", "layouts");

// The rules that keep physical left and right on a right-to-left page,
// each with its reason.
const PHYSICAL: [RegExp, string][] = [
  [/^\.up-launcher|^\.up-tooltip/, "The launcher and its tooltips stay on the left edge in every language."],
  [/^\.up-window-stage|^\.up-(trash|daw)-stage/, "Each window stage starts at the launcher's edge."],
  [/^\.up-(dash|hud)(-panel)?$/, "The Dash and the HUD hang from the launcher's corner, but their contents mirror."],
  [/^\.up-notify-host$/, "The notification bubbles stack at the top right."],
  [/^\.up-desktop-label$/, "The desktop label sits at the wallpaper's bottom right."],
  [/^\.up-resize-/, "resize.ts names each zone by its physical edge."],
  [/^\.up-daw-/, "The Studio's body carries dir=\"ltr\"."],
  [/^\.xterm/, "The vendored xterm.js block, whose terminal carries dir=\"ltr\"."],
];

const SIDED = /^(left|right|(margin|padding|border|scroll-margin|scroll-padding)-(left|right)(-[a-z]+)?|border-(top|bottom)-(left|right)-radius)$/;

// Splits a value at the spaces outside parentheses, so color-mix() and
// calc() stay whole.
function words(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let word = "";
  for (const c of value) {
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === " " && depth === 0) {
      if (word) out.push(word);
      word = "";
    } else word += c;
  }
  if (word) out.push(word);
  return out;
}

// True when a 1 to 4 value box shorthand, such as padding, sets its
// right side apart from its left.
function lopsided(value: string): boolean {
  const [t, r = t, , l = r] = words(value);
  return r !== l;
}

// The declarations of a rule that differ between its left and right
// sides. A rule that sets both sides alike, or centers itself with
// left:50%, mirrors onto itself.
function physical(decls: ReadonlyMap<string, string>): string[] {
  return [...decls].flatMap(([prop, value]) => {
    const v = value.replace(/\s*!important$/, "");
    if (SIDED.test(prop)) {
      const twin = decls.get(prop.replace(/left|right/, (s) => (s === "left" ? "right" : "left")));
      if (twin === value || (prop === "left" && v === "50%")) return [];
      return [`${prop}:${value}`];
    }
    if (/^(text-align|float|clear)$/.test(prop) && /^(left|right)$/.test(v)) return [`${prop}:${value}`];
    if (/^(margin|padding|inset|border-(width|style|color))$/.test(prop) && lopsided(v)) {
      return [`${prop}:${value}`];
    }
    if (prop === "border-radius" && !v.includes("/")) {
      // Corners in the order top-left, top-right, bottom-right, bottom-left.
      const [tl, tr = tl, br = tl, bl = tr] = words(v);
      if (tl !== tr || br !== bl) return [`${prop}:${value}`];
    }
    return [];
  });
}

// Each linear gradient in a value, with no space around its commas.
function gradients(value: string): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(/(?:repeating-)?linear-gradient\(/g)) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < value.length; i++) {
      if (value[i] === "(") depth++;
      else if (value[i] === ")" && --depth === 0) {
        out.push(value.slice(m.index, i + 1).replace(/\s*,\s*/g, ","));
        break;
      }
    }
  }
  return out;
}

// The gradient that mirrors g from side to side. A gradient that runs
// straight up or down mirrors onto itself.
function mirror(g: string): string {
  return g.replace(/\(([^,]+),/, (all, dir: string) => {
    const deg = /^(-?[\d.]+)deg$/.exec(dir);
    if (deg) return `(${(360 - Number(deg[1])) % 360}deg,`;
    if (dir.startsWith("to ")) return `(${dir.replace(/left|right/, (s) => (s === "left" ? "right" : "left"))},`;
    return all;
  });
}

// The gradients of a rule's own properties. A gradient in a custom
// property paints whichever rule reads it.
function ruleGradients(decls: ReadonlyMap<string, string>): string[] {
  return [...decls].filter(([prop]) => !prop.startsWith("--")).flatMap(([, value]) => gradients(value));
}

// The rules whose gradient mirrors with an ancestor's scaleX(-1), each
// with that ancestor.
const FLIPS_WITH: Record<string, string> = {
  ".up-reader-progress-bar": ".up-reader-progress",
};

// The partials whose glyphs keep their direction, each with its reason.
const LTR: Record<string, string> = {
  "_partials/unity/daw-window.html": "The Studio's body carries dir=\"ltr\".",
};

// The glyphs that point along the reading direction.
const DIRECTIONAL = /"glyphs\/((pathbar-)?(back|forward)|(chevron|arrow)-(left|right))"/g;

// The class of the nearest element that opens before offset i, so the
// element that holds a glyph rendered at i.
function hostClass(html: string, i: number): string | undefined {
  return [...html.slice(0, i).matchAll(/<[a-z][^>]*\sclass="([\w-]+)/g)].at(-1)?.[1];
}

const partials = readdirSync(layouts, { encoding: "utf8", recursive: true }).filter((f) => f.endsWith(".html"));

describe("text direction", () => {
  it("keeps physical left and right to the surfaces placed against the launcher", () => {
    const sided = rules.flatMap((r) => physical(r.decls).map((d) => ({ selector: r.selector, decl: d })));
    const stray = sided
      .filter(({ selector }) => !PHYSICAL.some(([pattern]) => pattern.test(selector)))
      .map(({ selector, decl }) => `${selector} ${decl}`);
    expect(stray).toEqual([]);
    const unused = PHYSICAL.filter(([pattern]) => !sided.some(({ selector }) => pattern.test(selector)));
    expect(unused.map(([pattern]) => `${pattern} matches no physical rule, so drop its row`)).toEqual([]);
  });

  it("mirrors each directional glyph on a right-to-left page", () => {
    const mirrored = new Set(
      rules
        .filter((r) => /^scaleX\(-1\)$/.test(r.decls.get("transform") ?? ""))
        .flatMap((r) => /^\[dir="rtl"\] \.([\w-]+) svg$/.exec(r.selector)?.slice(1) ?? []),
    );
    const glyphs = partials.filter((f) => !(f in LTR)).flatMap((f) => {
      const html = readFileSync(join(layouts, f), "utf8");
      return [...html.matchAll(DIRECTIONAL)].map((m) => ({ where: `${f} ${m[1]}`, host: hostClass(html, m.index) }));
    });
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.filter((g) => !g.host || !mirrored.has(g.host)).map((g) => `${g.where} in .${g.host}`)).toEqual([]);
  });

  it("mirrors each gradient that runs from side to side on a right-to-left page", () => {
    const rtl = (selector: string) => rules.filter((r) => r.selector === `[dir="rtl"] ${selector}`);
    const flips = (selector: string) => rtl(selector).some((r) => /^scaleX\(-1\)$/.test(r.decls.get("transform") ?? ""));
    const across = rules
      .filter((r) => !r.selector.startsWith('[dir="rtl"] ') && !PHYSICAL.some(([pattern]) => pattern.test(r.selector)))
      .flatMap((r) => ruleGradients(r.decls).filter((g) => mirror(g) !== g).map((g) => ({ selector: r.selector, g })));
    const unmirrored = across.filter(({ selector, g }) =>
      !flips(FLIPS_WITH[selector] ?? selector) && !rtl(selector).some((r) => ruleGradients(r.decls).includes(mirror(g))));
    expect(unmirrored.map(({ selector, g }) => `${selector} ${g}`)).toEqual([]);
    const unused = Object.keys(FLIPS_WITH).filter((s) => !across.some(({ selector }) => selector === s));
    expect(unused.map((s) => `${s} has no gradient that runs from side to side, so drop its row`)).toEqual([]);
  });

  it("marks each partial that keeps its glyphs' direction with dir=\"ltr\"", () => {
    const unmarked = Object.keys(LTR).filter((f) => !readFileSync(join(layouts, f), "utf8").includes('dir="ltr"'));
    expect(unmarked).toEqual([]);
  });

  // The browser floor in head/css.html predates :dir(), and css.Build
  // passes it through unchanged.
  it("selects a right-to-left page with [dir=\"rtl\"], not :dir()", () => {
    expect(css).not.toMatch(/:dir\(/);
    expect(rules.some((r) => r.selector.startsWith('[dir="rtl"] '))).toBe(true);
  });
});
