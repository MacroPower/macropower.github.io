// Every constant table is read-only, so no code can change what other code
// reads from it. The type checks cover the tables that modules export to
// each other. A type equals Readonly<> of itself only when its top level is
// already read-only. Each check compares the two, so `npm run
// typecheck:test` fails when a table loses its readonly. The imports are
// types only, so the suite loads none of the DOM modules it names.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { NAMED_ACTIONS, VOLUME_CONTROLS } from "./actions";
import type * as audio from "./audio";
import type { MASK_COLORS, PALETTE, PALETTE_BRIGHT } from "./shell/ansi";
import type { ALL_COMMANDS } from "./shell/commands/all";
import type { TEST_DATA } from "./shell/testkit";
import type { TABLE_BUTTONS, TOOLBAR_ACTIONS } from "./solitaire/controls";
import type { RANK_LABELS, SUITS } from "./solitaire/klondike";
import type { ICONS, IconName, PAL } from "./solitaire/sprites";
import type { declarations, rules, siteTokens } from "./testkit";

describe("exported tables", () => {
  it("are read-only", () => {
    expectTypeOf<typeof audio.PARAM_DEFAULTS>().toEqualTypeOf<Readonly<typeof audio.PARAM_DEFAULTS>>();
    expectTypeOf<typeof PALETTE>().toEqualTypeOf<Readonly<typeof PALETTE>>();
    expectTypeOf<typeof PALETTE_BRIGHT>().toEqualTypeOf<Readonly<typeof PALETTE_BRIGHT>>();
    expectTypeOf<typeof MASK_COLORS>().toEqualTypeOf<Readonly<typeof MASK_COLORS>>();
    expectTypeOf<typeof ALL_COMMANDS>().toEqualTypeOf<Readonly<typeof ALL_COMMANDS>>();
    expectTypeOf<typeof TEST_DATA>().toEqualTypeOf<Readonly<typeof TEST_DATA>>();
    expectTypeOf<typeof siteTokens>().toEqualTypeOf<ReadonlyMap<string, string>>();
    expectTypeOf<typeof rules>().toEqualTypeOf<Readonly<typeof rules>>();
    expectTypeOf<typeof declarations>().toEqualTypeOf<Readonly<typeof declarations>>();
    expectTypeOf<typeof SUITS>().toEqualTypeOf<Readonly<typeof SUITS>>();
    expectTypeOf<typeof RANK_LABELS>().toEqualTypeOf<Readonly<typeof RANK_LABELS>>();
    expectTypeOf<typeof PAL>().toEqualTypeOf<Readonly<typeof PAL>>();
    expectTypeOf<typeof ICONS>().toEqualTypeOf<Readonly<typeof ICONS>>();
    expectTypeOf<typeof TABLE_BUTTONS>().toEqualTypeOf<Readonly<typeof TABLE_BUTTONS>>();
    expectTypeOf<typeof TOOLBAR_ACTIONS>().toEqualTypeOf<Readonly<typeof TOOLBAR_ACTIONS>>();
    expectTypeOf<typeof NAMED_ACTIONS>().toEqualTypeOf<Readonly<typeof NAMED_ACTIONS>>();
    expectTypeOf<typeof VOLUME_CONTROLS>().toEqualTypeOf<Readonly<typeof VOLUME_CONTROLS>>();
  });

  it("hold read-only icon rows", () => {
    type Rows = (typeof ICONS)[IconName];
    expectTypeOf<Rows>().toEqualTypeOf<Readonly<Rows>>();
  });
});

describe("getParams", () => {
  it("returns the params read-only, so setParam is the only writer", () => {
    type Params = ReturnType<typeof audio.getParams>;
    expectTypeOf<Params>().toEqualTypeOf<Readonly<audio.SynthParams>>();
  });
});

// The scan covers the tables that a module keeps to itself, which no type
// check can import. A module-level const named in capitals holds a constant,
// and module state takes a camelCase name. When such a constant holds an
// array, object, Set, or Map literal, its declaration states a read-only
// type. It ends the literal with `as const`, or its annotation opens with
// `readonly`, `Readonly<`, `ReadonlyArray<`, `ReadonlySet<`, or
// `ReadonlyMap<`, directly or through a type alias in the same file.

const here = dirname(fileURLToPath(import.meta.url));

const CONSTANT = /^(?:export )?const ([A-Z][A-Z0-9_]*)\s*(:)?/gm;
const LITERAL = /^(?:\[|\{|new (?:Set|Map)\b[^(]*\()/;
const READONLY_TYPE = /^(?:readonly\s|Readonly(?:Array|Set|Map)?<)/;
const ALIAS = /^(?:export )?type (\w+) = ([^;]+);/gm;

/** Returns the index just past the string or comment that starts at `i`, or
 *  `i` when none starts there. */
function skipQuoted(src: string, i: number): number {
  const c = src.charAt(i);
  if (c === "/" && src.charAt(i + 1) === "/") return src.indexOf("\n", i) + 1 || src.length;
  if (c === "/" && src.charAt(i + 1) === "*") return src.indexOf("*/", i + 2) + 2;
  if (c !== '"' && c !== "'" && c !== "`") return i;
  for (let j = i + 1; j < src.length; j++) {
    if (src.charAt(j) === "\\") j++;
    else if (src.charAt(j) === c) return j + 1;
  }
  return src.length;
}

/** Returns the first index from `from` on, outside strings and comments,
 *  that `stop` accepts at the bracket depth it has reached since `from`, or
 *  -1 when no index does. */
function seek(src: string, from: number, stop: (i: number, depth: number) => boolean): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const past = skipQuoted(src, i);
    if (past > i) {
      i = past - 1;
      continue;
    }
    if (stop(i, depth)) return i;
    const c = src.charAt(i);
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
  }
  return -1;
}

/** Names each capitalized module-level const in `src` whose value is a
 *  table literal without a read-only type, with its line. */
function mutableTables(src: string): string[] {
  const aliases = new Map(Array.from(src.matchAll(ALIAS), (m) => [m[1] ?? "", (m[2] ?? "").trim()]));
  const found: string[] = [];
  for (const m of src.matchAll(CONSTANT)) {
    const name = m[1] ?? "";
    const typeStart = m.index + m[0].length;
    const assign = seek(src, typeStart, (i, depth) =>
      depth === 0 && src.charAt(i) === "=" && !"=>".includes(src.charAt(i + 1)));
    if (assign < 0) throw new Error(`no value for ${name}`);
    const value = src.slice(assign + 1).trimStart();
    const literal = LITERAL.exec(value);
    if (!literal) continue;
    const open = src.length - value.length + literal[0].length - 1;
    const close = seek(src, open, (i, depth) => depth === 1 && ")]}".includes(src.charAt(i)));
    const end = seek(src, close + 1, (i, depth) => depth === 0 && src.charAt(i) === ";");
    if (close < 0 || end < 0) throw new Error(`no end for ${name}`);
    const tail = src.slice(close + 1, end).trim();
    const type = m[2] ? src.slice(typeStart, assign).trim() : "";
    if (/^as const\b/.test(tail) || READONLY_TYPE.test(aliases.get(type) ?? type)) continue;
    found.push(`${name}:${src.slice(0, m.index).split("\n").length}`);
  }
  return found;
}

describe("module tables", () => {
  it("flag each table literal without a read-only type", () => {
    const src = [
      'const LIST = ["a"];',
      "const TYPED: Record<string, number> = { a: 1 };",
      'const SET = new Set<string>(["a"]);',
      'const LOOKUP = new Map([["a", 1]]);',
      "const CHECKED = { a: 1 } satisfies Record<string, number>;",
      'const INNER = [["a"] as const];',
      'const FROZEN = ["a"] as const;',
      "const SATISFIED = { a: 1 } as const satisfies Record<string, number>;",
      'const MARKED: readonly string[] = ["a; b"];',
      "const WRAPPED: Readonly<Record<string, () => void>> = {};",
      'const SEEN: ReadonlySet<string> = new Set(["a"]);',
      "type Row = readonly number[];",
      "const ROW: Row = [1];",
      "const LIMIT = 4;",
      "const state = { open: false };",
    ].join("\n");
    expect(mutableTables(src)).toEqual(["LIST:1", "TYPED:2", "SET:3", "LOOKUP:4", "CHECKED:5", "INNER:6"]);
  });

  it("are read-only in every module", () => {
    const scripts = readdirSync(here, { encoding: "utf8", recursive: true })
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith(".d.ts"));
    const strays = scripts.flatMap((file) =>
      mutableTables(readFileSync(join(here, file), "utf8")).map((table) => `${file} ${table}`));
    expect(strays).toEqual([]);
  });
});
