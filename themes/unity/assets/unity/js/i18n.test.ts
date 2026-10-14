import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { t, tn } from "./i18n";

const here = dirname(fileURLToPath(import.meta.url));

// The js_ tables in i18n/en.toml as key -> forms. The file is flat
// `[key]` tables of `one`/`other` strings, so a line parser suffices.
function readEnglish(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  let current: Record<string, string> | null = null;
  const text = readFileSync(join(here, "..", "..", "..", "i18n", "en.toml"), "utf8");
  for (const line of text.split("\n")) {
    const table = /^\[([^\]]+)\]\s*$/.exec(line);
    if (table) {
      current = table[1]!.startsWith("js_") ? {} : null;
      if (current) out.set(table[1]!, current);
      continue;
    }
    const form = /^(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (form && current) current[form[1]!] = JSON.parse(`"${form[2]!}"`) as string;
  }
  return out;
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && e.name !== "i18n.ts" ? [path] : [];
  });
}

// Every t()/tn() call in the bundles, by kind. The check cannot follow a
// key that is not a string literal, so it reports such calls as dynamic.
function calls(): { plain: Set<string>; plural: Set<string>; dynamic: string[] } {
  const plain = new Set<string>();
  const plural = new Set<string>();
  const dynamic: string[] = [];
  for (const file of sources(here)) {
    const text = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const m of text.matchAll(/(?<![\w$.])(tn?)\(\s*(["'`])?([^"'`,)\s]*)/g)) {
      if (m[2] !== '"' || !m[3]!.startsWith("js_")) {
        dynamic.push(`${file.slice(here.length + 1)}: ${m[0]}`);
        continue;
      }
      (m[1] === "tn" ? plural : plain).add(m[3]!);
    }
  }
  return { plain, plural, dynamic };
}

describe("runtime strings", () => {
  const english = readEnglish();
  const used = calls();

  it("passes every key as a string literal", () => {
    expect(used.dynamic).toEqual([]);
  });

  it("defines every key the scripts use, with the right shape", () => {
    for (const key of used.plain) expect(english.get(key)?.one, key).toBeUndefined();
    for (const key of used.plain) expect(english.get(key)?.other, key).toBeTypeOf("string");
    for (const key of used.plural) expect(english.get(key)?.one, key).toBeTypeOf("string");
    for (const key of used.plural) expect(english.get(key)?.other, key).toBeTypeOf("string");
  });

  it("uses every js_ key it defines", () => {
    const unused = [...english.keys()].filter((k) => !used.plain.has(k) && !used.plural.has(k));
    expect(unused).toEqual([]);
  });

  it("writes placeholders as {name}, never Go templates", () => {
    for (const [key, forms] of english) {
      for (const text of Object.values(forms)) expect(text, key).not.toContain("{{");
    }
  });

  it("puts {n} in every plural form", () => {
    for (const key of used.plural) {
      for (const text of Object.values(english.get(key) ?? {})) expect(text, key).toContain("{n}");
    }
  });
});

describe("t and tn", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  const install = (strings: Record<string, string>, plurals: Record<string, { forms: string[]; index: string }>): void => {
    (globalThis as { window?: unknown }).window = { UP_I18N: { strings, plurals } };
  };

  it("fills placeholders and leaves unknown ones alone", () => {
    install({ js_hi: "Hello, {name}. {missing}" }, {});
    expect(t("js_hi", { name: "Jane" })).toBe("Hello, Jane. {missing}");
  });

  it("falls back to the key", () => {
    install({}, {});
    expect(t("js_nope")).toBe("js_nope");
    expect(tn("js_nope", 3)).toBe("js_nope");
  });

  it("reads the form for each count from the index", () => {
    // Russian, the way Hugo would render it: "one" ends in 1 except 11,
    // "few" ends in 2-4 except 12-14, and "many" covers the rest.
    const form = (i: number): number => {
      const ten = i % 10;
      const hundred = i % 100;
      if (ten === 1 && hundred !== 11) return 0;
      if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 1;
      return 2;
    };
    const index = Array.from({ length: 200 }, (_, i) => form(i)).join("");
    install({}, { js_files: { forms: ["{n} файл", "{n} файла", "{n} файлов"], index } });
    expect(tn("js_files", 1)).toBe("1 файл");
    expect(tn("js_files", 34)).toBe("34 файла");
    expect(tn("js_files", 12)).toBe("12 файлов");
    expect(tn("js_files", 1021)).toBe("1021 файл");
    expect(tn("js_files", 1012)).toBe("1012 файлов");
  });
});

// Every table in i18n/en.toml as key -> forms.
function readAllEnglish(): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  let current: Record<string, string> = {};
  const text = readFileSync(join(here, "..", "..", "..", "i18n", "en.toml"), "utf8");
  for (const line of text.split("\n")) {
    const table = /^\[([^\]]+)\]\s*$/.exec(line);
    if (table) {
      current = {};
      out.set(table[1]!, current);
      continue;
    }
    const form = /^(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (form) current[form[1]!] = JSON.parse(`"${form[2]!}"`) as string;
  }
  return out;
}

function templates(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return templates(path);
    return /\.(html|xml|txt)$/.test(e.name) ? [path] : [];
  });
}

describe("template strings", () => {
  const english = readAllEnglish();
  const layouts = join(here, "..", "..", "..", "layouts");
  const files = templates(layouts).map((path) => ({
    name: path.slice(layouts.length + 1),
    text: readFileSync(path, "utf8").replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, ""),
  }));

  it("go through unity/ui/t, which falls back to the theme's English", () => {
    const direct = files
      .filter((f) => f.name !== "_partials/unity/ui/t.html" && f.name !== "_partials/unity/ui/i18n.html")
      .flatMap((f) => [...f.text.matchAll(/(?<![\w.$])T ["(]/g)].map(() => f.name));
    expect(direct).toEqual([]);
  });

  // Every key the templates pass to unity/ui/t. The alert render hooks
  // build theirs with printf "alert_%s", so a printf format stands for
  // every key that starts with its literal text. The check cannot follow
  // any other key that is not a string literal, so it reports such calls
  // as dynamic.
  const used = new Set<string>();
  const prefixes = new Set<string>();
  const dynamic: string[] = [];
  for (const f of files) {
    const re = /partial "unity\/ui\/t" (?:\(slice )?(?:"([a-z0-9_]+)"|\(printf "([a-z0-9_]+)%s"|(\S+))/g;
    for (const m of f.text.matchAll(re)) {
      if (m[1]) used.add(m[1]);
      else if (m[2]) prefixes.add(m[2]);
      else dynamic.push(`${f.name}: ${m[0]}`);
    }
  }
  const keys = [...english.keys()];

  it("pass every key as a string literal or a printf prefix", () => {
    expect(dynamic).toEqual([]);
  });

  it("name only keys en.toml defines", () => {
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((k) => !english.has(k))).toEqual([]);
    expect([...prefixes].filter((p) => !keys.some((k) => k.startsWith(p)))).toEqual([]);
  });

  it("use every key en.toml defines outside js_", () => {
    const unused = keys.filter((k) =>
      !k.startsWith("js_") && !used.has(k) && ![...prefixes].some((p) => k.startsWith(p)));
    expect(unused).toEqual([]);
  });

  it("use only {{ .Name }} placeholders, which unity/ui/t can fill", () => {
    for (const [key, forms] of english) {
      if (key.startsWith("js_")) continue;
      for (const text of Object.values(forms)) {
        expect(text.replace(/\{\{ \.\w+ \}\}/g, ""), key).not.toContain("{{");
      }
    }
  });
});
