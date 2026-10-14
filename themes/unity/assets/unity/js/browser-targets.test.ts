import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { css } from "./testkit";

const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "");

// head/css.html builds the stylesheet with css.Build for the browsers in
// its target list. css.Build lowers native nesting for them, but it passes
// the features in FEATURES through unchanged, so every target must support
// each one the stylesheet uses.
const partial = stripComments(
  readFileSync(join(here, "..", "..", "..", "layouts", "_partials", "unity", "head", "css.html"), "utf8"),
);
const source = `${partial}\n${css}`;

// The target list as versions keyed by browser, such as firefox: "121".
const targets = new Map<string, string>();
for (const m of /"target" \(slice ([^)]*)\)/.exec(partial)?.[1]?.matchAll(/"([a-z]+)([\d.]+)"/g) ?? []) {
  targets.set(m[1]!, m[2]!);
}

// True when version a is at least version b, such as "16.4" and "16".
function atLeast(a: string, b: string): boolean {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

interface Feature {
  // Matches the feature in the stylesheet source.
  marker: RegExp;
  // The first version of each target browser that supports the feature,
  // from MDN's browser-compat-data. Opera's version is Chrome's minus 14.
  floor: Record<string, string>;
  // Set when a target might lack the feature, with the reason the gap
  // costs visitors on that target nothing they need.
  degrades?: string;
}

const FEATURES: Record<string, Feature> = {
  ":has()": {
    marker: /:has\(/,
    floor: { chrome: "105", edge: "105", firefox: "121", ios: "15.4", opera: "91", safari: "15.4" },
  },
  "color-mix()": {
    marker: /color-mix\(/,
    floor: { chrome: "111", edge: "111", firefox: "113", ios: "16.2", opera: "97", safari: "16.2" },
  },
  // The newest of the logical properties the stylesheet uses.
  "logical corner radii": {
    marker: /border-(start|end)-(start|end)-radius/,
    floor: { chrome: "89", edge: "89", firefox: "66", ios: "15", opera: "75", safari: "15" },
  },
  "@layer": {
    marker: /@layer\b/,
    floor: { chrome: "99", edge: "99", firefox: "97", ios: "15.4", opera: "85", safari: "15.4" },
  },
  "@media (prefers-contrast: more)": {
    marker: /@media \(prefers-contrast: more\)/,
    floor: { chrome: "96", edge: "96", firefox: "101", ios: "14.5", opera: "82", safari: "14.1" },
  },
  "@media (scripting: none)": {
    marker: /@media \(scripting: none\)/,
    floor: { chrome: "120", edge: "120", firefox: "113", ios: "17", opera: "106", safari: "17" },
    degrades:
      "A browser that lacks the media feature skips the no-JavaScript fallback styles, " +
      "and only a visitor with JavaScript turned off sees those.",
  },
};

// The Requirements section of README.md, which names each target's
// browser and version.
const readme = readFileSync(join(here, "..", "..", "..", "README.md"), "utf8");
const requirements = /^## Requirements\n([\s\S]*?)^## /m.exec(readme)?.[1] ?? "";
const LABELS: Record<string, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  ios: "Safari",
  opera: "Opera",
  safari: "Safari",
};

describe("browser targets", () => {
  it("reads the target list from head/css.html", () => {
    expect([...targets.keys()].sort()).toEqual(Object.keys(LABELS).sort());
  });

  it("names every target in the Requirements of README.md", () => {
    const missing = [...targets]
      .map(([browser, version]) => `${LABELS[browser]} ${version}`)
      .filter((name) => !requirements.includes(name));
    expect(requirements).not.toBe("");
    expect(missing).toEqual([]);
  });

  for (const [name, feature] of Object.entries(FEATURES)) {
    it(`${feature.degrades ? "lets a target lack" : "supports"} ${name} in every target`, () => {
      expect(source, `the stylesheet no longer uses ${name}, so drop its row`).toMatch(feature.marker);
      const lacking = [...targets]
        .filter(([browser, version]) => {
          const floor = feature.floor[browser];
          return floor === undefined || !atLeast(version, floor);
        })
        .map(([browser, version]) => `${browser}${version}`);
      if (feature.degrades) {
        expect(lacking.length, `every target supports ${name}, so drop its degrades reason`).toBeGreaterThan(0);
      } else {
        expect(lacking).toEqual([]);
      }
    });
  }
});
