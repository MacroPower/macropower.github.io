import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

// main.css without its comments.
const css = readFileSync(join(here, "..", "css", "main.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const readme = readFileSync(join(here, "..", "..", "..", "README.md"), "utf8");
const scripts = readdirSync(here, { encoding: "utf8", recursive: true })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => readFileSync(join(here, f), "utf8"))
  .join("\n");

// The first :root block holds the tokens a site may set.
const root = /^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "";
const tokens = new Map([...root.matchAll(/(--up-[\w-]+)\s*:([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));

// Every declaration in main.css, with the selectors of the rules around it.
function declarations(text: string): { rule: string; decl: string }[] {
  const out: { rule: string; decl: string }[] = [];
  const rules: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      rules.push(text.slice(start, i).trim().replace(/\s+/g, " "));
    } else if (c === ";" || c === "}") {
      const decl = text.slice(start, i).trim();
      if (decl) out.push({ rule: rules.join(" "), decl });
      if (c === "}") rules.pop();
    } else {
      continue;
    }
    start = i + 1;
  }
  return out;
}

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
      if (!hex) return [name, (decl: string) => decl.replace(/\s+/g, " ").includes(value.replace(/\s+/g, " "))] as const;
      const [r, g, b] = hex.slice(1).map((h) => parseInt(h, 16));
      const re = new RegExp(`${value}\\b|rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\b`, "i");
      return [name, (decl: string) => re.test(decl)] as const;
    });
    const strays = declarations(css)
      // The token declarations themselves, and the accent presets.
      .filter(({ rule }) => rule !== ":root" && !rule.includes("[data-up-accent="))
      .flatMap(({ rule, decl }) => patterns.filter(([, has]) => has(decl)).map(([name]) => `${name} in ${rule}`));
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
      // The danger rows of the top panel's menus.
      "--up-accent in .up-dropdown-row &.is-danger:hover",
      // A pressed dialog button.
      "--up-content-line in .up-dlg-btn &:active",
      // The Studio's mute light.
      "--up-accent-light in .up-daw-ms &.is-mute",
    ]);
  });
});
