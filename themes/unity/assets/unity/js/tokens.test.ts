import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { accentPresets, css, declarations, siteTokens as tokens } from "./testkit";

const here = dirname(fileURLToPath(import.meta.url));

const readme = readFileSync(join(here, "..", "..", "..", "README.md"), "utf8");
const scripts = readdirSync(here, { encoding: "utf8", recursive: true })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => readFileSync(join(here, f), "utf8"))
  .join("\n");

describe("tokens", () => {
  it("lists every site-facing token in README.md", () => {
    const rows = readme.match(/^ *\| `--up-.*$/gm) ?? [];
    const listed = rows.flatMap((row) => row.split("|")[1]!.match(/--up-[\w-]+/g) ?? []);
    expect(listed.sort()).toEqual([...tokens.keys()].sort());
  });

  it("reads every custom property main.css declares", () => {
    const declared = new Set([...css.matchAll(/(--up-[\w-]+)\s*:/g)].map((m) => m[1]!));
    const unread = [...declared].filter((name) =>
      !new RegExp(`var\\(\\s*${name}\\s*[,)]`).test(css) && !scripts.includes(`"${name}"`));
    expect(unread).toEqual([]);
  });

  it("declares or sets every custom property main.css reads", () => {
    const read = new Set([...css.matchAll(/var\((--up-[\w-]+)/g)].map((m) => m[1]!));
    const unset = [...read].filter((name) => !new RegExp(`${name}\\s*:`).test(css) && !scripts.includes(`"${name}"`));
    expect(unset).toEqual([]);
  });

  it("repeats no token's value outside the token", () => {
    const patterns = [...tokens].map(([name, value]) => {
      const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
      if (!hex) return [name, (text: string) => text.replace(/\s+/g, " ").includes(value.replace(/\s+/g, " "))] as const;
      const [r, g, b] = hex.slice(1).map((h) => parseInt(h, 16));
      const re = new RegExp(`${value}\\b|rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\b`, "i");
      return [name, (text: string) => re.test(text)] as const;
    });
    const strays = declarations
      // The token declarations themselves.
      .filter(({ path }) => path !== ":root")
      .flatMap(({ path, value }) => patterns.filter(([, has]) => has(value)).map(([name]) => `${name} in ${path}`));
    // Each of these paints another role in the same color, so a site that
    // sets the token leaves it alone.
    expect(strays).toEqual([
      // Light status text on the CV viewer's dark page area.
      "--up-content-line in .up-docv-status",
      // The placeholder behind a sponsor's avatar.
      "--up-sidebar-bg in .up-sponsor-avatar",
      // The icon page's toast.
      "--up-terminal-bg in .up-icons-toast",
      // The dark code block and its copy button.
      "--up-chrome-2 in :is(.up-reader-body, .up-page-body) pre",
      "--up-panel-grad-1 in .up-code-copy",
      "--up-chrome-1 in .up-code-copy",
      "--up-chrome-2 in .up-code-copy",
      "--up-chrome-2 in .up-code-copy &:active",
      // A pressed dialog button.
      "--up-content-line in .up-dlg-btn &:active",
    ]);
  });

  it("repeats no internal token's gradient or shadow outside the token", () => {
    // The internal tokens, such as the recipe tokens, whose value has more
    // than one word. A single color or length can paint an unrelated role,
    // but a repeated gradient or shadow is a recipe copy that skipped its
    // token.
    const internal = declarations.flatMap(({ prop, value }) =>
      prop.startsWith("--up-") && !tokens.has(prop) && value.includes(" ") ? [[prop, value] as const] : []);
    expect(internal.length).toBeGreaterThan(0);
    const strays = declarations
      .filter(({ prop }) => !prop.startsWith("--"))
      .flatMap(({ path, value }) =>
        internal.filter(([, shared]) => value.includes(shared)).map(([name]) => `${name} in ${path}`));
    expect(strays).toEqual([
      // The Dash paints the same faint top highlight outside the Studio,
      // where the token is unset.
      "--up-daw-btn-shadow in .up-dash-tile &:focus",
      "--up-daw-btn-shadow in .up-dash-lens &.is-active",
    ]);
  });

  it("repeats the orange preset in the internal accent block", () => {
    // The block paints a page whose site removes every preset.
    const orange = accentPresets.find((p) => p.name === "orange");
    expect(orange).toBeDefined();
    const block = new Map(declarations.filter(({ path }) => path === ":root").map(({ prop, value }) => [prop, value]));
    const shades = [
      ["--up-accent", orange?.color],
      ["--up-accent-light", orange?.light],
      ["--up-accent-dark", orange?.dark],
      ["--up-accent-darker", orange?.darker],
    ] as const;
    const differ = shades.flatMap(([token, preset]) => {
      const value = block.get(token);
      return value?.toLowerCase() === preset?.toLowerCase() && value !== undefined
        ? []
        : [`${token} is ${value} in main.css and ${preset} in hugo.toml`];
    });
    expect(differ).toEqual([]);
  });
});
