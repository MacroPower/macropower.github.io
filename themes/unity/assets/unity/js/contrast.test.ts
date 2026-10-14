import { describe, expect, it } from "vitest";

import { accentPresets, rules, type Rule } from "./testkit";

const isMore = (r: Rule): boolean => r.media.includes("prefers-contrast: more");
const isForced = (r: Rule): boolean => r.media.includes("forced-colors: active");
// The rules a screen draws without a contrast preference.
const screen = rules.filter((r) => !isMore(r) && !isForced(r) && !r.media.includes("print"));
// The rules a screen draws when the visitor asks for more contrast, in
// source order, so a later rule overrides an earlier one.
const screenMore = rules.filter((r) => !isForced(r) && !r.media.includes("print"));

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

// The value of the last rule in `list` that sets `prop` on exactly this
// selector.
function last(list: Rule[], selector: string, prop: string): string | undefined {
  let value: string | undefined;
  for (const r of list) if (r.selector === selector && r.decls.has(prop)) value = r.decls.get(prop);
  return value;
}

// A trailing state, such as ":hover" or ".is-today".
const STATE = /(:hover|:focus-visible|:focus|:active|\.is-[\w-]+)$/;

// The text colors on a fill. The first is the fill's own color, or else
// the color of its selector without its states, such as .up-cal-cell for
// .up-cal-cell.is-today. Each color a descendant rule sets follows.
function textColors(list: Rule[], selector: string): { selector: string; color: string }[] {
  let own: string | undefined;
  for (let s = selector; own === undefined; ) {
    own = last(list, s, "color");
    const next = s.replace(STATE, "");
    if (next === s) break;
    s = next;
  }
  const out = own === undefined ? [] : [{ selector, color: own }];
  const nested = new Set(list.filter((r) => r.selector.startsWith(`${selector} `)).map((r) => r.selector));
  for (const s of nested) {
    const color = last(list, s, "color");
    if (color !== undefined) out.push({ selector: s, color });
  }
  return out;
}

interface Preset {
  name: string;
  dark: string | undefined;
  darker: string | undefined;
}

// The dark shades of each accent preset, plus the internal accent
// block's values, which paint a page whose site removes every preset.
const presets: Preset[] = [...accentPresets];
const fallback = rules.find((r) => r.selector === ":root" && r.decls.has("--up-accent-dark"))?.decls;
presets.push({
  name: "fallback",
  dark: fallback?.get("--up-accent-dark"),
  darker: fallback?.get("--up-accent-darker"),
});

// A fill that reads the base accent or its lighter shade, which contrast
// less than 4.5:1 with white for some presets.
const LIGHT_FILL = /var\(--up-accent(-light)?\)/;

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

  it("fills every accent highlight under white text with a dark shade when asked", () => {
    const filled = [
      ...new Set(
        screen
          .filter((r) => !r.selector.includes("::") && LIGHT_FILL.test(fill(r) ?? ""))
          .filter((r) => textColors(screen, r.selector).some((t) => whiteAlpha(t.color) !== undefined))
          .map((r) => r.selector),
      ),
    ];
    expect(filled).toEqual(expect.arrayContaining([
      ".up-naut-item.is-active", ".up-post-row.is-active", ".up-hud-row.is-selected",
      ".up-menu-item:hover", ".up-cal-cell.is-today", ".up-dropdown-btn:hover",
    ]));
    const bare = filled.filter((s) => {
      const more = last(rules.filter(isMore), s, "background");
      return more === undefined || LIGHT_FILL.test(more) || !/var\(--up-accent-dark(er)?\)/.test(more);
    });
    expect(bare).toEqual([]);
  });

  it("keeps white text at 4.5:1 on each dark fill when asked", () => {
    expect(presets.map((p) => p.name)).toEqual(expect.arrayContaining(["orange", "green", "aubergine", "blue", "fallback"]));
    const fills = rules.filter((r) => isMore(r) && /var\(--up-accent-dark(er)?\)/.test(fill(r) ?? ""));
    expect(fills.length).toBeGreaterThan(0);
    const low = fills.flatMap((r) => {
      const shade = /var\(--up-accent-darker\)/.test(fill(r)!) ? "darker" : "dark";
      return textColors(screenMore, r.selector).flatMap(({ selector, color }) => {
        const alpha = whiteAlpha(color);
        if (alpha === undefined) return [];
        return presets.flatMap((p) => {
          const hex = p[shade];
          if (hex === undefined || !/^#[0-9a-f]{6}$/i.test(hex)) return [`${p.name} has no #rrggbb ${shade} shade`];
          const under = rgb(hex);
          return contrast(over(WHITE, alpha, under), under) < 4.5 ? [`${selector} ${color} on ${p.name} ${shade}`] : [];
        });
      });
    });
    expect(low).toEqual([]);
  });

  it("puts the more-contrast block before the forced-colors block", () => {
    // Both apply on a system that forces colors and asks for more
    // contrast, and the Highlight fills must win.
    const lastMore = rules.findLastIndex(isMore);
    expect(lastMore).toBeGreaterThan(-1);
    expect(lastMore).toBeLessThan(rules.findIndex(isForced));
  });
});
