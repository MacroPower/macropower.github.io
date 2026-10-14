import { describe, expect, it } from "vitest";

import { accentPresets, rules, siteTokens, type Rule } from "./testkit";

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
  color: string | undefined;
  light: string | undefined;
  lighter: string | undefined;
  dark: string | undefined;
  darker: string | undefined;
}

// The shades of each accent preset that this test checks, plus the
// internal accent block's values, which paint a page whose site removes
// every preset.
const presets: Preset[] = [...accentPresets];
const fallback = rules.find((r) => r.selector === ":root" && r.decls.has("--up-accent-dark"))?.decls;
presets.push({
  name: "fallback",
  color: fallback?.get("--up-accent"),
  light: fallback?.get("--up-accent-light"),
  lighter: fallback?.get("--up-accent-lighter"),
  dark: fallback?.get("--up-accent-dark"),
  darker: fallback?.get("--up-accent-darker"),
});

// The custom properties in props with a preset's accent shades in place
// of the internal accent block's.
function withPreset(props: ReadonlyMap<string, string>, p: Preset): ReadonlyMap<string, string> {
  const shades = [
    ["--up-accent", p.color], ["--up-accent-light", p.light], ["--up-accent-lighter", p.lighter],
    ["--up-accent-dark", p.dark], ["--up-accent-darker", p.darker],
  ] as const;
  return new Map([...props, ...shades.flatMap(([name, hex]) => (hex === undefined ? [] : [[name, hex] as const]))]);
}

// The color stops of a background, in 0-255. A translucent stop sits on
// white, the lightest backdrop, where light text contrasts least.
function stops(background: string): number[][] {
  const value = background.replace(/var\((--up-[\w-]+)\)/g, (m: string, name: string) => siteTokens.get(name) ?? m);
  const colors = /color-mix\(in srgb,\s*(#[0-9a-f]{6})\s+([\d.]+)%,\s*transparent\)|rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)|(#[0-9a-f]{6})\b/gi;
  return [...value.matchAll(colors)].map((m) => {
    if (m[1] !== undefined) return over(rgb(m[1]), Number(m[2]) / 100, WHITE);
    if (m[3] !== undefined) return over([m[3], m[4], m[5]].map(Number), Number(m[6]), WHITE);
    return rgb(m[7]!);
  });
}

// The custom properties that the :root blocks outside any at-rule
// declare, with their values.
const rootProps: ReadonlyMap<string, string> = new Map(
  rules
    .filter((r) => r.selector === ":root" && r.media === "")
    .flatMap((r) => [...r.decls].filter(([prop]) => prop.startsWith("--"))),
);

// A dark pair of content colors, such as a site sets in custom.css. Each
// test of the content tokens checks the theme's default colors and these.
const DARK_PAIR: ReadonlyMap<string, string> = new Map([
  ["--up-content-bg", "#1E1E1E"],
  ["--up-content-fg", "#EEEEEE"],
  ["--up-content-muted", "#AAAAAA"],
  ["--up-content-line", "#444444"],
  ["--up-link", "#8AB4F8"],
  ["--up-sidebar-bg", "#2A2A2A"],
]);

// The custom properties under the default colors and under the dark pair.
const PAIRS: readonly (readonly [string, ReadonlyMap<string, string>])[] = [
  ["the default colors", rootProps],
  ["a dark pair", new Map([...rootProps, ...DARK_PAIR])],
];

// Splits a value at its top-level commas.
function args(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "(") depth++;
    else if (value[i] === ")") depth--;
    else if (value[i] === "," && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out;
}

// A color value in 0-255. It reads a #rgb or #rrggbb color, white, a
// var() of a property in props, or a color-mix() in srgb of two such
// values. Any other value, such as a gradient, yields undefined.
function color(value: string, props: ReadonlyMap<string, string>): number[] | undefined {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return rgb(v);
  if (/^#[0-9a-f]{3}$/i.test(v)) return rgb(`#${[...v.slice(1)].map((c) => c + c).join("")}`);
  if (v === "white") return WHITE;
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    const next = props.get(ref[1]!);
    return next === undefined ? undefined : color(next, props);
  }
  const mix = /^color-mix\(in srgb,([\s\S]*)\)$/.exec(v);
  if (!mix) return undefined;
  const parts = args(mix[1]!).map((part) => {
    const m = /^([\s\S]*?)(?:\s+([\d.]+)%)?$/.exec(part)!;
    return { c: color(m[1]!, props), p: m[2] === undefined ? undefined : Number(m[2]) / 100 };
  });
  const [a, b] = parts;
  if (parts.length !== 2 || !a?.c || !b?.c) return undefined;
  const p = a.p ?? (b.p === undefined ? 0.5 : 1 - b.p);
  return over(a.c, p, b.c);
}

// The colors a background paints: each stop of a linear gradient, or the
// one color of a plain value. A var() resolves through props first.
function surfaceColors(value: string, props: ReadonlyMap<string, string>): (number[] | undefined)[] {
  const v = value.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  const next = ref ? props.get(ref[1]!) : undefined;
  if (next !== undefined) return surfaceColors(next, props);
  const gradient = /^linear-gradient\(([\s\S]*)\)$/.exec(v);
  if (!gradient) return [color(v, props)];
  return args(gradient[1]!)
    .filter((stop) => !/^(\d+deg|to\s)/.test(stop))
    .map((stop) => color(stop.replace(/\s+[\d.]+%$/, ""), props));
}

// True when a value reads a custom property whose name matches `name`,
// directly or through the internal tokens that the :root blocks declare.
function reads(value: string, name: RegExp, depth = 0): boolean {
  return [...value.matchAll(/var\((--up-[\w-]+)\)/g)].some((m) => {
    if (name.test(m[1]!)) return true;
    const next = rootProps.get(m[1]!);
    return depth < 4 && next !== undefined && reads(next, name, depth + 1);
  });
}

// True when a value reads a content token or the sidebar's, directly or
// through the internal tokens mixed from them.
const readsContent = (value: string): boolean => reads(value, /^--up-(content-[\w-]+|sidebar-bg)$/);

// The accent shades that text on a light surface reads, and the lighter
// shade that text and marks on a dark surface read.
const ACCENT = /^--up-accent(-light|-dark|-darker)?$/;
const LIGHTER = /^--up-accent-lighter$/;

// The content surfaces, which the content inks and accent text sit on.
const CONTENT_SURFACES: readonly string[] = ["--up-content-bg", "--up-content-raised", "--up-content-sunken", "--up-content-shade"];

// The rules that paint a page, without the :root blocks that declare the
// tokens and without the frames of an animation.
const painting = screen.filter((r) => r.selector !== ":root" && !r.media.includes("@keyframes"));

// The values that a rule paints its accent with: its text color, each
// custom property that reads the lighter shade, or else its background.
function accentPaints(r: Rule): string[] {
  const text = r.decls.get("color");
  if (text !== undefined) return [text];
  const props = [...r.decls].filter(([prop, value]) => prop.startsWith("--") && reads(value, LIGHTER)).map(([, value]) => value);
  if (props.length > 0) return props;
  const background = fill(r);
  return background === undefined ? [] : [background];
}

// The frames of each animation that a rule runs, each with the color and
// the opacity that it sets.
function frames(r: Rule): { color: string | undefined; opacity: number }[] {
  const names = (r.decls.get("animation") ?? r.decls.get("animation-name") ?? "").split(/[\s,]+/).filter(Boolean);
  return rules
    .filter((k) => names.some((name) => k.media.endsWith(`@keyframes ${name}`)))
    .map((k) => ({ color: k.decls.get("color"), opacity: Number(k.decls.get("opacity") ?? 1) }));
}

// A translucent rgba() color, such as a trough over a surface.
function translucent(value: string | undefined): { rgb: number[]; alpha: number } | undefined {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value?.trim() ?? "");
  return m ? { rgb: [m[1], m[2], m[3]].map(Number), alpha: Number(m[4]) } : undefined;
}

// True when a value paints an opaque color that it writes out, or that
// an internal token it reads writes out. A color mixed with transparent,
// or an rgba() color that is not opaque, paints an overlay instead.
function paintsLiteral(value: string): boolean {
  let v = value;
  for (let depth = 0; depth < 4; depth++) v = v.replace(/var\((--up-[\w-]+)\)/g, (m: string, name: string) => rootProps.get(name) ?? m);
  v = v.replace(/color-mix\(in srgb,[^()]*transparent\)/g, "");
  if (/#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{6}ff)\b|\b(white|black)\b/i.test(v)) return true;
  return [...v.matchAll(/rgba?\(([^)]*)\)/g)].some((m) => {
    const alpha = m[1]!.split(/[\s,/]+/).filter(Boolean)[3];
    return alpha === undefined || Number(alpha) === 1;
  });
}

// Each rule that paints accent text or a mark on a dark surface, by
// selector. Each names the rule that paints the surface and the contrast
// that the shade keeps there. Text needs 4.5:1, and a mark, such as a
// state's dot, an icon, or a bar's fill, needs 3:1. A bar names the rule
// that paints its translucent trough over the surface. A rule whose
// surface lightens under the pointer, such as a row that fills with the
// accent, names the rules that repaint its text there.
const ON_DARK = new Map<string, { surface: string; trough?: string; min: number; hover?: readonly string[] }>([
  [".up-dropdown-row.is-hotspot-status", { surface: ".up-dropdown", min: 4.5, hover: [".up-dropdown-row.is-hotspot-status:hover"] }],
  [".up-net-row.is-on .up-net-row-dot", { surface: ".up-dropdown", min: 3, hover: [".up-net-row:hover .up-net-row-dot"] }],
  [".up-lang-row.is-on::before", { surface: ".up-dropdown", min: 3, hover: [".up-lang-row:hover::before"] }],
  [".up-vol-play.is-playing", { surface: ".up-dropdown", min: 3 }],
  [".up-vol-slider", { surface: ".up-dropdown", min: 3 }],
  [".up-indicator.is-hotspot", {
    surface: ".up-top-panel", min: 3, hover: [".up-indicator.is-hotspot:hover", ".up-indicator.is-hotspot.is-open"],
  }],
  [".up-bat-bar-fill", { surface: ".up-dropdown", trough: ".up-bat-bar", min: 3 }],
  [".up-notify-bar-fill", { surface: ".up-notify-bubble", trough: ".up-notify-bar", min: 3 }],
]);

// A fill that reads the base accent or its lighter shade, which contrast
// less than 4.5:1 with white for some presets.
const LIGHT_FILL = /var\(--up-accent(-light)?\)/;

describe("contrast", () => {
  it("keeps every alert's title and body at 4.5:1 on its bar", () => {
    const base = screen.find((r) => r.selector === ".up-alert");
    const title = screen.find((r) => r.selector === ".up-alert-title")?.decls.get("color");
    expect(base).toBeDefined();
    expect(title).toBeDefined();
    const kinds = screen.filter((r) => /^\.up-alert(\.is-[\w-]+)?$/.test(r.selector) && r.decls.has("--up-alert-ink"));
    expect(kinds.map((r) => r.selector)).toEqual(expect.arrayContaining([".up-alert", ".up-alert.is-tip"]));
    const low = PAIRS.flatMap(([pair, props]) => kinds.flatMap((kind) => {
      // The kind's hues override the base rule's, as on the page.
      const scope = new Map([...props, ...base!.decls, ...kind.decls]);
      const bar = surfaceColors(fill(base!) ?? "", scope);
      const texts = [["title", color(title!, scope)], ["body", color("var(--up-content-fg)", scope)]] as const;
      return texts.flatMap(([text, ink]) => bar.flatMap((under, i) => {
        if (!ink || !under) return [`${kind.selector} ${text} has a color that this test cannot read`];
        return contrast(ink, under) < 4.5 ? [`${kind.selector} ${text} on stop ${i} under ${pair}`] : [];
      }));
    }));
    expect(low).toEqual([]);
  });

  it("pairs a content ink only with a content surface", () => {
    // A rule that paints its own background and its text takes both from
    // the content tokens or neither. A site's dark pair then never leaves
    // light text on a light surface or dark text on a dark one.
    const mixed = screen.flatMap((r) => {
      const ink = r.decls.get("color");
      const surface = fill(r);
      if (ink === undefined || surface === undefined) return [];
      if (readsContent(ink) && !readsContent(surface) && paintsLiteral(surface)) return [`${r.selector} paints a content ink on ${surface}`];
      if (readsContent(surface) && !readsContent(ink) && paintsLiteral(ink)) return [`${r.selector} paints ${ink} on a content surface`];
      return [];
    });
    expect(mixed).toEqual([
      // The page's default text color, which each window inherits. No text
      // sits on the black behind the wallpaper.
      "html paints a content ink on #000",
      "body paints a content ink on #000",
    ]);
  });

  it("keeps each content ink at 4.5:1 on each content surface", () => {
    const inks = ["--up-content-fg", "--up-content-muted", "--up-content-ink", "--up-content-label"];
    // The sidebar shows the full text color and the labels.
    const sidebar = ["--up-content-fg", "--up-content-label"];
    const low = PAIRS.flatMap(([pair, props]) => {
      const pairs = [
        ...CONTENT_SURFACES.flatMap((surface) => inks.map((ink) => [ink, surface] as const)),
        ...sidebar.map((ink) => [ink, "--up-sidebar-bg"] as const),
      ];
      return pairs.flatMap(([ink, surface]) => {
        const fg = color(`var(${ink})`, props);
        const under = surfaceColors(`var(${surface})`, props);
        if (!fg || under.length === 0 || under.some((u) => !u)) return [`${ink} on ${surface} has a color that this test cannot read`];
        return under.some((u) => contrast(fg, u!) < 4.5) ? [`${ink} on ${surface} under ${pair}`] : [];
      });
    });
    expect(low).toEqual([]);
  });

  it("keeps accent text at 4.5:1 on each content surface for each preset", () => {
    // Accent text on a dark surface reads the lighter shade, and ON_DARK
    // checks it. Every other accent text, such as a link under the
    // pointer, sits on a content surface.
    const texts = painting.filter((r) => {
      const ink = r.decls.get("color");
      return ink !== undefined && reads(ink, ACCENT) && !reads(ink, LIGHTER);
    });
    expect(texts.map((r) => r.selector)).toEqual(expect.arrayContaining([
      ".up-reader-body a:hover", ".up-reader-license a:hover", ".up-toc a:hover", ".up-projects-noscript a:hover",
      ".up-404-links a:hover", ".up-dlg-content-body a:hover", ".up-icons-no",
    ]));
    const low = PAIRS.flatMap(([pair, base]) => presets.flatMap((p) => {
      const props = withPreset(base, p);
      return texts.flatMap((r) => {
        const ink = color(r.decls.get("color")!, props);
        if (!ink) return [`${r.selector} has a color that this test cannot read for ${p.name}`];
        const short = CONTENT_SURFACES.filter((surface) =>
          surfaceColors(`var(${surface})`, props).some((u) => !u || contrast(ink, u) < 4.5));
        return short.length > 0 ? [`${r.selector} for ${p.name} under ${pair} on ${short.join(", ")}`] : [];
      });
    }));
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

  it("paints accent text and marks on a dark surface with the lighter shade", () => {
    // A control that draws its parts from tokens, such as the volume
    // slider, paints the shade through a custom property. A bar's fill
    // paints it through a recipe token.
    const lighter = painting
      .filter((r) => [...r.decls].some(([prop, value]) =>
        (prop === "color" || prop.startsWith("--") || prop.startsWith("background")) && reads(value, LIGHTER)))
      .map((r) => r.selector);
    expect(lighter).toEqual(expect.arrayContaining([...ON_DARK.keys()]));
    expect(lighter.filter((s) => !ON_DARK.has(s))).toEqual([]);
  });

  it("keeps the lighter shade readable on each dark surface", () => {
    const low = [...ON_DARK].flatMap(([selector, { surface, trough, min }]) => {
      const rule = screen.find((r) => r.selector === surface);
      let under = rule ? stops(fill(rule) ?? "") : [];
      if (under.length === 0) return [`${surface} has no background that this test reads`];
      if (trough !== undefined) {
        const bar = screen.find((r) => r.selector === trough);
        const layer = translucent(bar ? fill(bar) : undefined);
        if (!layer) return [`${trough} has no translucent background that this test reads`];
        under = under.map((stop) => over(layer.rgb, layer.alpha, stop));
      }
      const own = screen.filter((r) => r.selector === selector);
      const paints = own.flatMap(accentPaints);
      if (paints.length === 0) return [`${selector} paints nothing that this test reads`];
      // Each frame of an animation paints its own color, or else the
      // rule's, at its own opacity.
      const inks = [
        ...paints.map((value) => ({ value, alpha: 1 })),
        ...own.flatMap(frames).map((f) => ({ value: f.color ?? paints[0]!, alpha: f.opacity })),
      ];
      return presets.flatMap((p) => {
        const props = withPreset(rootProps, p);
        return inks.flatMap(({ value, alpha }) => surfaceColors(value, props).flatMap((ink) => {
          if (!ink) return [`${selector} paints ${value}, which this test cannot read for ${p.name}`];
          return under
            .filter((stop) => contrast(over(ink, alpha, stop), stop) < min)
            .map((stop) => `${selector} ${value} at ${alpha} on ${stop.map(Math.round).join(",")} for ${p.name}`);
        }));
      });
    });
    expect(low).toEqual([]);
  });

  it("repaints accent text where its surface turns lighter under the pointer", () => {
    const bare = [...ON_DARK].flatMap(([selector, { hover = [] }]) => {
      const at = screen.findLastIndex((r) => r.selector === selector && r.decls.has("color"));
      // An animation of the color overrides the repaint, so the repaint
      // stops it.
      const animated = screen.filter((r) => r.selector === selector).flatMap(frames).some((f) => f.color !== undefined);
      return hover.filter((state) => {
        const fix = screen.findLastIndex((r) => r.selector === state && r.decls.has("color"));
        if (fix <= at || /--up-accent/.test(screen[fix]!.decls.get("color")!)) return true;
        return animated && screen[fix]!.decls.get("animation") !== "none";
      });
    });
    expect(bare).toEqual([]);
  });

  it("puts the more-contrast block before the forced-colors block", () => {
    // Both apply on a system that forces colors and asks for more
    // contrast, and the Highlight fills must win.
    const lastMore = rules.findLastIndex(isMore);
    expect(lastMore).toBeGreaterThan(-1);
    expect(lastMore).toBeLessThan(rules.findIndex(isForced));
  });
});
