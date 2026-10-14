import { describe, expect, it } from "vitest";

import { accentPresets as presets, rules, siteTokens } from "./testkit";

const accent = /var\(\s*--up-accent/;

// The rules a screen draws without forced colors.
const screen = rules.filter((r) => !/forced-colors|print/.test(r.media));

// Splits a value at its top-level commas, so a color-mix() stays whole.
function splitTop(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out;
}

const BORDER = /^border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?$/;
const SPREAD = /^(?:inset\s+)?0 0 0 [\d.]+px\s+(.+)$/;

// The accent cues that a rule draws without an outline: each border
// color and each shadow that only spreads, which rings the box like an
// outline.
function edgeCues(decls: ReadonlyMap<string, string>): string[] {
  const borders = [...decls].filter(([prop]) => BORDER.test(prop)).map(([, value]) => value);
  const shadows = splitTop(decls.get("box-shadow") ?? "").flatMap((s) => SPREAD.exec(s)?.[1] ?? []);
  return [...borders, ...shadows].filter((c) => accent.test(c));
}

// A cue that paints a ring's shade at full opacity, with no mix toward
// the surface under it.
const PLAIN = /(?:^|\s)var\(--up-accent(?:-lighter)?\)$/;

const noOutline = (outline: string | undefined): boolean => outline === undefined || /^(none|0)$/.test(outline);

// The color of the last focus cue among the screen rules that name one
// of these selectors. A rule's cue is its outline, or else its edge cue
// at full opacity, or else its first edge cue.
function ringColor(...selectors: string[]): string | undefined {
  let color: string | undefined;
  for (const r of screen) {
    if (!selectors.includes(r.selector)) continue;
    const outline = r.decls.get("outline");
    const edges = edgeCues(r.decls);
    color = r.decls.get("outline-color") ?? (noOutline(outline) ? undefined : outline)
      ?? edges.find((c) => PLAIN.test(c)) ?? edges[0] ?? color;
  }
  return color;
}

// WCAG relative luminance of a #rrggbb color.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const s = parseInt(hex.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const HEX = /^#[0-9a-f]{6}$/i;

// The light surfaces under the rings that paint --up-accent: each stop of
// the sidebar gradient and the content background.
const surfaces = ["--up-sidebar-bg", "--up-content-bg"].flatMap((name) =>
  siteTokens.get(name)?.match(/#[0-9a-f]{6}\b/gi) ?? []);

// An rgba() color laid over white, as #rrggbb.
function overWhite(rgba: string): string {
  const [r = 0, g = 0, b = 0, a = 1] = rgba.replace(/^rgba\(|\)$/g, "").split(",").map(Number);
  return `#${[r, g, b].map((c) => Math.round(c * a + 255 * (1 - a)).toString(16).padStart(2, "0")).join("")}`;
}

// The Dash and the HUD lay translucent glass over the desktop. Each stop
// of the glass over white is the lightest that the glass can look.
const glass = [".up-dash-panel", ".up-hud-panel"]
  .flatMap((selector) => screen.find((r) => r.selector === selector)?.decls.get("background")?.match(/rgba\([^)]*\)/g) ?? [])
  .map(overWhite);

// The dark surfaces under the rings that paint --up-accent-lighter: each
// stop of the titlebar gradients, the home terminal's banner, the
// Studio's surfaces and buttons, and the glass. The code block's copy
// button repeats the titlebar gradient.
const studio = rules.find((r) => r.selector === ".up-daw-body" && r.decls.has("--up-daw-bg"))?.decls;
const darkSurfaces = [
  ...["--up-chrome-1", "--up-chrome-2", "--up-chrome-inactive-1", "--up-chrome-inactive-2", "--up-terminal-bg"]
    .map((name) => siteTokens.get(name)),
  ...["--up-daw-bg", "--up-daw-panel", "--up-daw-btn-bg", "--up-daw-btn-bg-hover"].map((name) => studio?.get(name)),
].flatMap((value) => value?.match(/#[0-9a-f]{6}\b/gi) ?? []).concat(glass);

describe("focus rings", () => {
  it("draws every accent ring 2px solid in a plain accent token", () => {
    const rings = rules
      .filter((r) => r.selector.includes(":focus"))
      .flatMap((r) => {
        const outline = r.decls.get("outline");
        return outline && accent.test(outline) ? [`${r.selector} ${outline}`] : [];
      });
    expect(rings.length).toBeGreaterThan(0);
    const weak = rings.filter((ring) => !/ 2px solid var\(--up-accent(-lighter)?\)$/.test(ring));
    expect(weak).toEqual([]);
  });

  it("rings every control that all:unset strips of the browser's ring", () => {
    // all:unset also unsets the outline that the browser draws on focus,
    // so each such control must draw a ring of its own.
    const unset = screen.filter((r) => r.decls.get("all") === "unset").map((r) => r.selector);
    expect(unset).toEqual(expect.arrayContaining([".up-icons-seg button", ".up-icons-cell"]));
    const bare = unset.filter((base) => !screen.some((r) => {
      const outline = r.decls.get("outline");
      return [`${base}:focus-visible`, `${base}:focus`].includes(r.selector) && outline !== undefined && !/^(none|0)$/.test(outline);
    }));
    expect(bare).toEqual([]);
  });

  it("paints no accent ring over a selected row's accent fill", () => {
    // Each element whose .is-active rule fills its background with the accent.
    const filled = rules
      .filter((r) => /^\.up-[\w-]+(?: [\w-]+)?\.is-active$/.test(r.selector))
      .filter((r) => accent.test(r.decls.get("background") ?? r.decls.get("background-color") ?? ""))
      .map((r) => r.selector.replace(/\.is-active$/, ""));
    expect(filled).toEqual(expect.arrayContaining([".up-naut-item", ".up-post-row", ".up-project-tile", ".up-trash-tile", ".up-icons-seg button"]));
    const hidden = filled.filter((base) => {
      const ring = ringColor(`${base}:focus-visible`);
      if (!ring || !accent.test(ring)) return false;
      const selected = ringColor(`${base}.is-active:focus-visible`);
      return !selected || accent.test(selected);
    });
    expect(hidden).toEqual([]);
  });

  it.each([
    // The site's highlight style might paint the code block light, where
    // --up-accent-lighter contrasts less than 3:1, so a shadow paints a
    // dark band under the ring and past its outer edge.
    ".up-code-copy:focus-visible",
    // --up-accent-lighter contrasts less than 3:1 with the CV page well,
    // so an inset shadow paints a dark band under the ring and as far
    // again inside it.
    ".up-docv-view:focus-visible",
  ])("bands the ring of %s in dark", (selector) => {
    const ring = screen.filter((r) => r.selector === selector && r.decls.has("outline")).at(-1);
    const offset = Number.parseFloat(ring?.decls.get("outline-offset") ?? "0");
    const band = /(?:^|,)\s*(inset )?0 0 0 ([\d.]+)px (#[0-9a-f]{6})\s*(?:,|$)/i.exec(ring?.decls.get("box-shadow") ?? "");
    expect(band?.[3]).toMatch(HEX);
    const width = Number(band![2]);
    if (band![1]) {
      expect(offset).toBeLessThan(0);
      expect(width).toBeGreaterThanOrEqual(Math.abs(offset) + 2);
    } else expect(width).toBeGreaterThan(offset + 2);
    const low = presets
      .filter(({ lighter }) => lighter !== undefined && HEX.test(lighter) && contrast(lighter, band![3]!) < 3)
      .map(({ name }) => name);
    expect(low).toEqual([]);
  });

  it("paints every ring that skips the outline at full opacity", () => {
    // A border or a spread shadow can stand in for the outline, but a mix
    // toward transparent fades it into the surface under it, to less than
    // 3:1.
    const cued = screen.filter((r) => /:focus(?:-visible)?(?![\w-])/.test(r.selector) && edgeCues(r.decls).length > 0);
    expect(cued.map((r) => r.selector)).toEqual(expect.arrayContaining([".up-dash-search:focus", ".up-hud-input:focus"]));
    const faint = cued
      .filter((r) => !edgeCues(r.decls).some((c) => PLAIN.test(c)))
      .filter((r) => noOutline(screen.filter((o) => o.selector === r.selector && o.decls.has("outline")).at(-1)?.decls.get("outline")))
      .map((r) => r.selector);
    expect(faint).toEqual([]);
  });

  it("keeps each preset's ring shades at 3:1 or more", () => {
    // These rings sit on the light surfaces, where --up-accent-light
    // contrasts less than 3:1 for some presets.
    const onLight = [
      ".up-naut-item", ".up-post-row", ".up-project-tile", ".up-trash-tile",
      ".up-docv-thumb", ".up-docv-btn", ".up-docv-pagenum", ".up-pathbar-btn", ".up-pathbar-search-input",
      ".up-dlg-btn", ".up-icons-cell", ".up-icons-seg button",
    ].filter((base) => !/var\(--up-accent\)/.test(ringColor(`${base}:focus-visible`, `${base}:focus`) ?? ""));
    expect(onLight).toEqual([]);
    // These rings sit on the dark surfaces, where --up-accent-light
    // contrasts less than 3:1 for some presets.
    const onDark = [
      ".up-launcher-tile", ".up-tl", ".up-code-copy", ".up-docv-view", ".up-shell .up-sr-only a",
      ".up-dash-search", ".up-dash-more", ".up-dash-tile", ".up-dash-lens", ".up-hud-input",
      ".up-daw-lcd", ".up-daw-section-title", ".up-daw-ms", ".up-daw-patch", ".up-daw-patchmenu-item",
      ".up-daw-wave", ".up-daw-time", ".up-daw-knob-dial",
    ].filter((base) => !/var\(--up-accent-lighter\)/.test(ringColor(`${base}:focus-visible`, `${base}:focus`) ?? ""));
    expect(onDark).toEqual([]);
    expect(presets.map((p) => p.name)).toEqual(expect.arrayContaining(["orange", "green", "aubergine", "blue"]));
    expect(surfaces.length).toBeGreaterThan(1);
    expect(glass.length).toBeGreaterThan(5);
    expect(darkSurfaces.length).toBeGreaterThan(13);
    const low = presets.flatMap(({ name, color, light, lighter }) => {
      if (!color || !HEX.test(color) || !light || !HEX.test(light) || !lighter || !HEX.test(lighter)) {
        return [`${name}: color ${color}, light ${light}, or lighter ${lighter} is not #rrggbb`];
      }
      return [
        // The white ring sits on a selected row's fill, which starts at light.
        ...(contrast(light, "#ffffff") < 3 ? [`${name}: white on light ${light}`] : []),
        // The --up-accent ring sits on the light surfaces.
        ...surfaces.filter((s) => contrast(color, s) < 3).map((s) => `${name}: color ${color} on ${s}`),
        // The --up-accent-lighter ring sits on the dark surfaces.
        ...darkSurfaces.filter((s) => contrast(lighter, s) < 3).map((s) => `${name}: lighter ${lighter} on ${s}`),
      ];
    });
    expect(low).toEqual([]);
  });
});
