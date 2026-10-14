import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import { EN_TOML, KEYS_TS, readCatalog, renderKeys } from "../../../scripts/i18n-types";
import { isolate, t, tn } from "./i18n";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = readCatalog(readFileSync(EN_TOML, "utf8"));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && e.name !== "i18n.ts" ? [path] : [];
  });
}

// The key of every t()/tn() call in the bundles. The check cannot follow
// a key that is not a string literal, so it reports such calls as dynamic.
function calls(): { keys: Set<string>; dynamic: string[] } {
  const keys = new Set<string>();
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
      keys.add(m[3]!);
    }
  }
  return { keys, dynamic };
}

// The argument text of each call to `key`, with the file it sits in.
function argsOf(key: string): string[] {
  const found: string[] = [];
  for (const file of sources(here)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(new RegExp(`(?<![\\w$.])tn?\\(\\s*"${key}"`, "g"))) {
      const start = m.index + m[0].length;
      let depth = 1;
      let end = start;
      while (end < text.length && depth > 0) {
        if (text[end] === "(") depth++;
        else if (text[end] === ")") depth--;
        end++;
      }
      found.push(`${file.slice(here.length + 1)}: ${text.slice(start, end - 1).replace(/\s+/g, " ").replace(/^ ?, /, "")}`);
    }
  }
  return found;
}

// Each key with a placeholder that a site's config, data, or content
// fills, mapped to that placeholder.
const SITE_NAMES: Readonly<Record<string, string>> = {
  js_panel_feed_copied: "url",
  js_panel_feed_url: "url",
  js_panel_hotspot_status: "name",
  js_panel_hotspot_active_body: "name",
  js_panel_logout_title: "name",
  js_panel_net_already_body: "name",
  js_panel_net_connect_title: "name",
  js_panel_net_disconnect_body: "name",
  js_panel_net_failed_body: "name",
  js_panel_net_established_body: "name",
  js_panel_paused_named: "name",
  js_panel_muted_named: "name",
  js_trash_open_title: "name",
  js_trash_delete_title: "name",
  js_studio_title_named: "name",
  js_projects_license: "value",
  js_projects_open_on: "host",
};

// tsc checks each key and its placeholders against i18n-keys.ts, so these
// checks cover only what the types cannot see.
describe("runtime strings", () => {
  const english = new Map([...catalog].filter(([key]) => key.startsWith("js_")));
  const used = calls();

  it("matches the generated key types", () => {
    expect(readFileSync(KEYS_TS, "utf8"), "run `npm run i18n:types`").toBe(renderKeys(catalog));
  });

  // The generator runs on a copy of the theme, so the check above still
  // reads the committed file. Node starts it through a symlink, because a
  // site can link the theme in.
  it("regenerates the key types when Node runs the generator", () => {
    const root = mkdtempSync(join(tmpdir(), "up-i18n-"));
    try {
      const theme = join(root, "theme");
      for (const dir of ["scripts", "i18n", "assets/unity/js"]) mkdirSync(join(theme, dir), { recursive: true });
      writeFileSync(join(theme, "package.json"), '{ "type": "module" }\n');
      copyFileSync(join(here, "..", "..", "..", "scripts", "i18n-types.ts"), join(theme, "scripts", "i18n-types.ts"));
      copyFileSync(EN_TOML, join(theme, "i18n", "en.toml"));
      symlinkSync(theme, join(root, "link"), "dir");
      execFileSync(process.execPath, [join(root, "link", "scripts", "i18n-types.ts")], { stdio: "pipe" });
      expect(readFileSync(join(theme, "assets", "unity", "js", "i18n-keys.ts"), "utf8")).toBe(renderKeys(catalog));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes every key as a string literal", () => {
    expect(used.dynamic).toEqual([]);
  });

  it("uses every js_ key it defines", () => {
    const unused = [...english.keys()].filter((k) => !used.keys.has(k));
    expect(unused).toEqual([]);
  });

  it("writes placeholders as {name}, never Go templates", () => {
    for (const [key, forms] of english) {
      for (const text of Object.values(forms)) expect(text, key).not.toContain("{{");
    }
  });

  it("isolates every name that a site fills into a sentence", () => {
    const bare: string[] = [];
    for (const [key, slot] of Object.entries(SITE_NAMES)) {
      const forms = Object.values(english.get(key) ?? {});
      expect(forms.join(" "), key).toContain(`{${slot}}`);
      const found = argsOf(key);
      expect(found, key).not.toEqual([]);
      const isolated = new RegExp(`\\b${slot}\\s*:[^,}]*\\bisolate\\(`);
      bare.push(...found.filter((call) => !isolated.test(call)));
    }
    expect(bare).toEqual([]);
  });

  it("puts {n} in every plural form", () => {
    for (const [key, forms] of english) {
      if (!("one" in forms)) continue;
      for (const text of Object.values(forms)) expect(text, key).toContain("{n}");
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
    install({ js_panel_source_body_link: "Hello, {link}. {missing}" }, {});
    expect(t("js_panel_source_body_link", { link: "Jane" })).toBe("Hello, Jane. {missing}");
  });

  it("isolates a name the way <bdi dir=\"auto\"> does", () => {
    expect(isolate("שלום")).toBe("\u2068שלום\u2069");
    install({ js_panel_net_connect_title: "Connect to {name}?" }, {});
    const title = t("js_panel_net_connect_title", { name: isolate("Free WiFi!") });
    expect(title).toBe("Connect to \u2068Free WiFi!\u2069?");
    expect(title.replace(/[\u2068\u2069]/g, "")).toBe("Connect to Free WiFi!?");
  });

  it("falls back to the key", () => {
    install({}, {});
    expect(t("js_close")).toBe("js_close");
    expect(tn("js_trash_items", 3)).toBe("js_trash_items");
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
    install({}, { js_trash_items: { forms: ["{n} файл", "{n} файла", "{n} файлов"], index } });
    expect(tn("js_trash_items", 1)).toBe("1 файл");
    expect(tn("js_trash_items", 34)).toBe("34 файла");
    expect(tn("js_trash_items", 12)).toBe("12 файлов");
    expect(tn("js_trash_items", 1021)).toBe("1021 файл");
    expect(tn("js_trash_items", 1012)).toBe("1012 файлов");
  });
});

// tsc checks the keys and placeholders of these calls against
// i18n-keys.ts, so `npm run typecheck:test` fails when a call that should
// not compile does. None of the calls runs.
describe("key and placeholder types", () => {
  it("rejects a key en.toml lacks or a call of the other kind", () => {
    const checks = (): string[] => [
      t("js_close"),
      tn("js_trash_items", 2),
      // @ts-expect-error -- en.toml defines no js_nope.
      t("js_nope"),
      // @ts-expect-error -- js_trash_items is a plural, which tn() reads.
      t("js_trash_items"),
      // @ts-expect-error -- js_close is not a plural.
      tn("js_close", 2),
    ];
    expectTypeOf(checks).returns.toEqualTypeOf<string[]>();
  });

  it("rejects a missing or misspelled placeholder", () => {
    const checks = (): string[] => [
      t("js_panel_source_body_link", { link: "example.org" }),
      tn("js_solitaire_at_count", 3, { pile: "Stock" }),
      // @ts-expect-error -- the string fills {link}.
      t("js_panel_source_body_link"),
      // @ts-expect-error -- the string fills {link}, not {lnk}.
      t("js_panel_source_body_link", { lnk: "example.org" }),
      // @ts-expect-error -- the string fills {pile}.
      tn("js_solitaire_at_count", 3),
      // @ts-expect-error -- the string fills {pile}, not {piles}.
      tn("js_solitaire_at_count", 3, { piles: "Stock" }),
    ];
    expectTypeOf(checks).returns.toEqualTypeOf<string[]>();
  });

  it("rejects a placeholder the string lacks", () => {
    const checks = (): string[] => [
      // @ts-expect-error -- js_close has no placeholder.
      t("js_close", { name: "x" }),
      // @ts-expect-error -- the string has no {url}.
      t("js_panel_source_body_link", { link: "example.org", url: "x" }),
      // @ts-expect-error -- tn() fills {n} from its count.
      tn("js_solitaire_at_count", 3, { pile: "Stock", n: 4 }),
    ];
    expectTypeOf(checks).returns.toEqualTypeOf<string[]>();
  });
});

function templates(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return templates(path);
    return /\.(html|xml|txt)$/.test(e.name) ? [path] : [];
  });
}

describe("template strings", () => {
  const layouts = join(here, "..", "..", "..", "layouts");
  const files = templates(layouts).map((path) => ({
    name: path.slice(layouts.length + 1),
    text: readFileSync(path, "utf8").replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, ""),
  }));

  // A direct call of T or of its aliases i18n and lang.Translate, with
  // the function's name before its argument or after a pipe. The
  // lookbehind skips a method such as $x.T and names inside a path or
  // an id, such as unity/ui/i18n.html.
  const DIRECT_T =
    /(?<![\w.$/-])(?:T|i18n|lang\.Translate)\s+["`($.]|\|\s*(?:T|i18n|lang\.Translate)\s*(?:-?\}\}|\))/g;

  it("go through unity/ui/t, which falls back to the theme's English", () => {
    const direct = files
      .filter((f) => f.name !== "_partials/unity/ui/t.html" && f.name !== "_partials/unity/ui/i18n.html")
      .flatMap((f) => [...f.text.matchAll(DIRECT_T)].map(() => f.name));
    expect(direct).toEqual([]);
  });

  it("find every spelling of a direct call", () => {
    const calls = [
      '{{ T "k" }}',
      '{{ T ("k") }}',
      "{{ T $k }}",
      "{{ T .k }}",
      '{{ i18n "k" }}',
      '{{ lang.Translate "k" }}',
      '{{ "k" | T }}',
      '{{ "k" | i18n -}}',
      '{{ ("k" | lang.Translate) }}',
    ];
    const others = [
      '{{ partial "unity/ui/i18n.html" . }}',
      '{{ warnidf "unity-i18n-missing" "x" }}',
      '{{ $x.T "a" }}',
    ];
    expect(calls.filter((s) => !s.match(DIRECT_T))).toEqual([]);
    expect(others.filter((s) => s.match(DIRECT_T))).toEqual([]);
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
  const keys = [...catalog.keys()];

  it("pass every key as a string literal or a printf prefix", () => {
    expect(dynamic).toEqual([]);
  });

  it("name only keys en.toml defines", () => {
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((k) => !catalog.has(k))).toEqual([]);
    expect([...prefixes].filter((p) => !keys.some((k) => k.startsWith(p)))).toEqual([]);
  });

  it("use every key en.toml defines outside js_", () => {
    const unused = keys.filter((k) =>
      !k.startsWith("js_") && !used.has(k) && ![...prefixes].some((p) => k.startsWith(p)));
    expect(unused).toEqual([]);
  });

  it("use only {{ .Name }} placeholders, which unity/ui/t can fill", () => {
    for (const [key, forms] of catalog) {
      if (key.startsWith("js_")) continue;
      for (const text of Object.values(forms)) {
        expect(text.replace(/\{\{ \.\w+ \}\}/g, ""), key).not.toContain("{{");
      }
    }
  });
});
