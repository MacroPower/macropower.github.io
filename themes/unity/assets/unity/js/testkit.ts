// This module parses main.css once for the stylesheet's tests, so each
// test reads the rules and tokens instead of parsing the file again. It
// also reads the accent presets from the theme's hugo.toml.
// tsconfig.test.json type-checks this module. Hugo never bundles it,
// because no entrypoint imports it, and Vitest never runs it, because it
// is not a *.test.ts file.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseToml, TomlDate, type TomlTable, type TomlValue } from "smol-toml";

const here = dirname(fileURLToPath(import.meta.url));

// main.css without its comments.
export const css = readFileSync(join(here, "..", "css", "main.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The tokens that a site sets, from the first :root block, by name.
export const siteTokens: ReadonlyMap<string, string> = new Map(
  [...(/^:root\s*\{([^}]*)\}/m.exec(css)?.[1] ?? "").matchAll(/(--up-[\w-]+)\s*:([^;]+);/g)]
    .map((m) => [m[1]!, m[2]!.trim()]),
);

export interface Rule {
  // One selector of the rule, with nesting resolved, so
  // `.up-post-row { &.is-active {} }` yields ".up-post-row.is-active".
  readonly selector: string;
  // The at-rules around the rule, joined, such as "@media print".
  readonly media: string;
  // The rule's own declarations by property. The selectors of one rule
  // share one map.
  readonly decls: ReadonlyMap<string, string>;
}

export interface Declaration {
  // The preludes of the blocks around the declaration, as written and
  // joined, such as ".up-code-copy &:active" or
  // "@media (scripting: none) .up-shell".
  readonly path: string;
  readonly prop: string;
  readonly value: string;
}

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

interface Block {
  path: string;
  selectors: string[];
  media: string;
  decls: Map<string, string>;
}

function parse(): { rules: readonly Rule[]; declarations: readonly Declaration[] } {
  const rules: Rule[] = [];
  const declarations: Declaration[] = [];
  const open: Block[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c !== "{" && c !== ";" && c !== "}") continue;
    const text = css.slice(start, i).trim().replace(/\s+/g, " ");
    start = i + 1;
    const parent = open.at(-1);
    if (c === "{") {
      const parents = parent?.selectors ?? [];
      let media = parent?.media ?? "";
      let selectors: string[];
      if (text.startsWith("@")) {
        // An at-rule such as @media passes its parent's selectors through.
        selectors = parents;
        media = `${media} ${text}`.trim();
      } else if (parents.length === 0) selectors = splitList(text);
      else {
        selectors = parents.flatMap((p) =>
          splitList(text).map((s) => (s.includes("&") ? s.replaceAll("&", p) : `${p} ${s}`)));
      }
      const block = { path: parent ? `${parent.path} ${text}` : text, selectors, media, decls: new Map<string, string>() };
      open.push(block);
      for (const selector of selectors) rules.push({ selector, media, decls: block.decls });
      continue;
    }
    const m = /^([\w-]+)\s*:([\s\S]+)$/.exec(text);
    if (m && parent) {
      const decl = { path: parent.path, prop: m[1]!, value: m[2]!.trim() };
      parent.decls.set(decl.prop, decl.value);
      declarations.push(decl);
    }
    if (c === "}") open.pop();
  }
  return { rules, declarations };
}

// Every rule in source order, one entry per selector, and every
// declaration in source order.
export const { rules, declarations } = parse();

export interface AccentPreset {
  // The preset's key under params.desktop.accents.
  readonly name: string;
  // The preset's colors as hugo.toml writes them. A key that the preset
  // leaves out is undefined.
  readonly color: string | undefined;
  readonly light: string | undefined;
  readonly dark: string | undefined;
  readonly darker: string | undefined;
}

function isTable(value: TomlValue | undefined): value is TomlTable {
  return typeof value === "object" && !Array.isArray(value) && !(value instanceof TomlDate);
}

const str = (value: TomlValue | undefined): string | undefined => (typeof value === "string" ? value : undefined);

function presets(): readonly AccentPreset[] {
  let table: TomlValue = parseToml(readFileSync(join(here, "..", "..", "..", "hugo.toml"), "utf8"));
  for (const key of ["params", "desktop", "accents"]) table = isTable(table) ? table[key] ?? {} : {};
  if (!isTable(table)) return [];
  // An entry that is not a table, such as false, removes a preset.
  return Object.entries(table).flatMap(([name, p]) => isTable(p)
    ? [{ name, color: str(p.color), light: str(p.light), dark: str(p.dark), darker: str(p.darker) }]
    : []);
}

// The accent presets in the theme's hugo.toml, in the order it writes
// them.
export const accentPresets = presets();
