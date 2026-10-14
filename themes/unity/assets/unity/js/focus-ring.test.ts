import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

// main.css without its comments.
const css = readFileSync(join(here, "..", "css", "main.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const toml = readFileSync(join(here, "..", "..", "..", "hugo.toml"), "utf8");

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

// Every rule in source order, one entry per selector, with nesting
// resolved, so `.up-post-row { &.is-active {} }` yields
// ".up-post-row.is-active". At-rules such as @media pass their parent's
// selectors through.
const rules: { selector: string; decls: Map<string, string> }[] = [];
{
  const open: string[][] = [];
  const own: Map<string, string>[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c !== "{" && c !== ";" && c !== "}") continue;
    const text = css.slice(start, i).trim().replace(/\s+/g, " ");
    start = i + 1;
    if (c === "{") {
      const parents = open.at(-1) ?? [];
      let selectors: string[];
      if (text.startsWith("@")) selectors = parents;
      else if (parents.length === 0) selectors = splitList(text);
      else {
        selectors = parents.flatMap((p) =>
          splitList(text).map((s) => (s.includes("&") ? s.replaceAll("&", p) : `${p} ${s}`)));
      }
      const decls = new Map<string, string>();
      open.push(selectors);
      own.push(decls);
      for (const selector of selectors) rules.push({ selector, decls });
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

const accent = /var\(\s*--up-accent/;

// The color of the last outline rule that names exactly this selector.
function ringColor(selector: string): string | undefined {
  let color: string | undefined;
  for (const r of rules) {
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

// The theme's accent presets, as name, color, and light.
const presets = toml
  .split(/^\s*(?=\[)/m)
  .flatMap((section) => {
    const name = /^\[params\.desktop\.accents\.(\w+)\]/.exec(section)?.[1];
    const color = /^\s*color\s*=\s*"(#[0-9a-f]{6})"/im.exec(section)?.[1];
    const light = /^\s*light\s*=\s*"(#[0-9a-f]{6})"/im.exec(section)?.[1];
    return name && color && light ? [{ name, color, light }] : [];
  });

// The light surfaces under the rings that paint --up-accent: each stop of
// the sidebar gradient and the content background.
const root = /^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
const surfaces = ["--up-sidebar-bg", "--up-content-bg"].flatMap((name) => {
  const value = new RegExp(`${name}\\s*:([^;]+);`).exec(root)?.[1] ?? "";
  return value.match(/#[0-9a-f]{6}\b/gi) ?? [];
});

describe("focus rings", () => {
  it("draws every accent ring 2px solid in a plain accent token", () => {
    const rings = rules
      .filter((r) => r.selector.includes(":focus"))
      .flatMap((r) => {
        const outline = r.decls.get("outline");
        return outline && accent.test(outline) ? [`${r.selector} ${outline}`] : [];
      });
    expect(rings.length).toBeGreaterThan(0);
    const weak = rings.filter((ring) => !/ 2px solid var\(--up-accent(-light)?\)$/.test(ring));
    expect(weak).toEqual([]);
  });

  it("paints no accent ring over a selected row's accent fill", () => {
    // Each element whose .is-active rule fills its background with the accent.
    const filled = rules
      .filter((r) => /^\.up-[\w-]+\.is-active$/.test(r.selector))
      .filter((r) => accent.test(r.decls.get("background") ?? r.decls.get("background-color") ?? ""))
      .map((r) => r.selector.replace(/\.is-active$/, ""));
    expect(filled).toEqual(expect.arrayContaining([".up-naut-item", ".up-post-row", ".up-project-tile", ".up-trash-tile"]));
    const hidden = filled.filter((base) => {
      const ring = ringColor(`${base}:focus-visible`);
      if (!ring || !accent.test(ring)) return false;
      const selected = ringColor(`${base}.is-active:focus-visible`);
      return !selected || accent.test(selected);
    });
    expect(hidden).toEqual([]);
  });

  it("keeps each preset's ring shades at 3:1 or more", () => {
    // These rings sit on the light surfaces, where --up-accent-light
    // contrasts less than 3:1 for some presets.
    const onLight = [
      ".up-naut-item", ".up-post-row", ".up-project-tile", ".up-trash-tile",
      ".up-docv-thumb", ".up-docv-btn", ".up-pathbar-btn", ".up-dlg-btn",
    ].filter((base) => !/var\(--up-accent\)/.test(ringColor(`${base}:focus-visible`) ?? ""));
    expect(onLight).toEqual([]);
    expect(presets.map((p) => p.name)).toEqual(expect.arrayContaining(["orange", "green", "aubergine", "blue"]));
    expect(surfaces.length).toBeGreaterThan(1);
    const low = presets.flatMap(({ name, color, light }) => [
      // The white ring sits on a selected row's fill, which starts at light.
      ...(contrast(light, "#ffffff") < 3 ? [`${name}: white on light ${light}`] : []),
      // The --up-accent ring sits on the light surfaces.
      ...surfaces.filter((s) => contrast(color, s) < 3).map((s) => `${name}: color ${color} on ${s}`),
    ]);
    expect(low).toEqual([]);
  });
});
