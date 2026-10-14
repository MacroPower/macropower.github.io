import { describe, expect, it } from "vitest";

import { accentPresets as presets, rules, siteTokens } from "./testkit";

const accent = /var\(\s*--up-accent/;

// The rules a screen draws without forced colors.
const screen = rules.filter((r) => !/forced-colors|print/.test(r.media));

// The color of the last outline rule on a screen that names exactly this
// selector.
function ringColor(selector: string): string | undefined {
  let color: string | undefined;
  for (const r of screen) {
    if (r.selector !== selector) continue;
    color = r.decls.get("outline-color") ?? r.decls.get("outline") ?? color;
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

// The dark surfaces under the rings that paint --up-accent-lighter: each
// stop of the titlebar gradients, which the code block's copy button
// repeats, and the Studio's surfaces and buttons.
const studio = rules.find((r) => r.selector === ".up-daw-body" && r.decls.has("--up-daw-bg"))?.decls;
const darkSurfaces = [
  ...["--up-chrome-1", "--up-chrome-2", "--up-chrome-inactive-1", "--up-chrome-inactive-2"].map((name) => siteTokens.get(name)),
  ...["--up-daw-bg", "--up-daw-panel", "--up-daw-btn-bg", "--up-daw-btn-bg-hover"].map((name) => studio?.get(name)),
].flatMap((value) => value?.match(/#[0-9a-f]{6}\b/gi) ?? []);

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

  it("bands the copy button's ring in dark on any code block", () => {
    // The site's highlight style might paint the code block light, where
    // --up-accent-lighter contrasts less than 3:1, so a shadow paints a
    // dark band under the ring and past its outer edge.
    const ring = screen.filter((r) => r.selector === ".up-code-copy:focus-visible" && r.decls.has("outline")).at(-1);
    const offset = Number.parseFloat(ring?.decls.get("outline-offset") ?? "0");
    const band = /(?:^|,)\s*0 0 0 ([\d.]+)px (#[0-9a-f]{6})\s*(?:,|$)/i.exec(ring?.decls.get("box-shadow") ?? "");
    expect(band?.[2]).toMatch(HEX);
    expect(Number(band![1])).toBeGreaterThan(offset + 2);
    const low = presets
      .filter(({ lighter }) => lighter !== undefined && HEX.test(lighter) && contrast(lighter, band![2]!) < 3)
      .map(({ name }) => name);
    expect(low).toEqual([]);
  });

  it("keeps each preset's ring shades at 3:1 or more", () => {
    // These rings sit on the light surfaces, where --up-accent-light
    // contrasts less than 3:1 for some presets.
    const onLight = [
      ".up-naut-item", ".up-post-row", ".up-project-tile", ".up-trash-tile",
      ".up-docv-thumb", ".up-docv-btn", ".up-pathbar-btn", ".up-dlg-btn",
      ".up-icons-cell", ".up-icons-seg button",
    ].filter((base) => !/var\(--up-accent\)/.test(ringColor(`${base}:focus-visible`) ?? ""));
    expect(onLight).toEqual([]);
    // These rings sit on the dark surfaces, where --up-accent-light
    // contrasts less than 3:1 for some presets.
    const onDark = [
      ".up-launcher-tile", ".up-tl", ".up-code-copy", ".up-daw-lcd", ".up-daw-section-title",
      ".up-daw-ms", ".up-daw-patch", ".up-daw-patchmenu-item", ".up-daw-wave", ".up-daw-time", ".up-daw-knob-dial",
    ].filter((base) => !/var\(--up-accent-lighter\)/.test(ringColor(`${base}:focus-visible`) ?? ""));
    expect(onDark).toEqual([]);
    expect(presets.map((p) => p.name)).toEqual(expect.arrayContaining(["orange", "green", "aubergine", "blue"]));
    expect(surfaces.length).toBeGreaterThan(1);
    expect(darkSurfaces.length).toBeGreaterThan(7);
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
