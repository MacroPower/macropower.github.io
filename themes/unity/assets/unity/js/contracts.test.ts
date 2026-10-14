// Builds sites with Hugo and checks the data their pages hand the scripts
// against the types the scripts declare. That data is the home terminal's
// data island and the window.UP_SITE and window.UP_I18N globals, which
// _partials/unity/ui/runtime.html sets. The other tests use hand-written
// fixtures, so only this suite notices a template that renames or drops a
// field. It skips when Hugo is not on PATH.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseShellIsland, type ShellIsland } from "./shell/island";
import { makeShell, type TestShell } from "./shell/testkit";
import type { UPAccent, UPI18n, UPSite } from "./types";

const theme = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const example = join(theme, "exampleSite");
const hugo = spawnSync("hugo", ["version"]).status === 0;

// The typeof of each field. `satisfies` fails to compile when UPSite or
// UPI18n gains or loses a field that its table lacks.
const SITE_FIELDS = {
  handle: "string", repo: "string", rss: "string", hotspot: "string", nav: "object", accents: "object",
} as const satisfies Record<keyof UPSite, "string" | "object">;
const ACCENT_FIELDS = { name: "string", label: "string" } as const satisfies Record<keyof UPAccent, "string">;
const I18N_FIELDS = { strings: "object", plurals: "object" } as const satisfies Record<keyof UPI18n, "object">;
const PLURAL_FIELDS = { forms: "object", index: "string" } as const satisfies Record<keyof UPI18n["plurals"][string], "string" | "object">;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The typeof of each of an object's fields, or null for a non-object.
function typesOf(value: unknown): Record<string, string> | null {
  return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v])) : null;
}

// The values of an object's fields, or none for a non-object.
function valuesOf(value: unknown): unknown[] {
  return isRecord(value) ? Object.values(value) : [];
}

// A Markdown file's body, without its TOML front matter, which might be
// empty.
function body(file: string): string {
  return readFileSync(file, "utf8").replace(/^\+\+\+\n(?:[\s\S]*?\n)?\+\+\+\n/, "");
}

// What a built site's home page hands the scripts.
interface Home {
  /** The island's text, or "" when the home page has none. */
  island: string;
  site: unknown;
  i18n: unknown;
}

// Builds a site and reads its home page's island and runtime script.
function build(out: string, args: string[]): Home {
  const run = spawnSync("hugo", ["--destination", out, "--minify", "--quiet", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`hugo ${args.join(" ")} failed:\n${run.stderr}`);
  const home = readFileSync(join(out, "index.html"), "utf8");
  const island = /<script[^>]*\sdata-shell-data[^>]*>([\s\S]*?)<\/script>/.exec(home)?.[1] ?? "";
  const src = /<script[^>]*\ssrc="?(\/js\/runtime\.[^"\s>]+)/.exec(home)?.[1];
  if (!src) throw new Error(`${out}/index.html does not load the runtime script`);
  const stub: Record<string, unknown> = {};
  runInNewContext(readFileSync(join(out, src), "utf8"), { window: stub });
  return { island, site: copy(stub.UP_SITE), i18n: copy(stub.UP_I18N) };
}

// A JSON copy moves a global out of the script's realm, so toEqual
// compares it as a plain object.
function copy(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

describe.skipIf(!hugo)("the data Hugo hands the scripts", () => {
  let work = "";
  const homes = new Map<"example" | "bare", Home>();

  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "unity-contracts-"));
    homes.set("example", build(join(work, "example-public"), ["--source", example, "--themesDir", dirname(theme)]));
    const bare = join(work, "bare");
    mkdirSync(bare);
    writeFileSync(join(bare, "hugo.toml"),
      `baseURL = "https://example.org/"\ntheme = "unity"\nthemesDir = ${JSON.stringify(dirname(theme))}\n`);
    homes.set("bare", build(join(work, "bare-public"), ["--source", bare]));
  }, 60_000);

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe.each(["example", "bare"] as const)("the %s site", (name) => {
    it("writes the island with exactly the fields the parser reads", () => {
      const { island } = homes.get(name)!;
      expect(island).not.toBe("");
      // The parser defaults a missing field and drops an unknown one, so
      // any field the template renames or drops makes the two differ.
      expect(parseShellIsland(island)).toEqual(JSON.parse(island));
    });

    it("sets UP_SITE with the fields of UPSite", () => {
      const { site } = homes.get(name)!;
      expect(typesOf(site)).toEqual(SITE_FIELDS);
      const nav = isRecord(site) ? site.nav : undefined;
      expect(valuesOf(nav).length).toBeGreaterThan(0);
      expect(valuesOf(nav).filter((url) => typeof url !== "string")).toEqual([]);
      const accents: unknown = isRecord(site) ? site.accents : undefined;
      expect(Array.isArray(accents)).toBe(true);
      const presets: unknown[] = Array.isArray(accents) ? accents : [];
      expect(presets.length).toBeGreaterThan(0);
      for (const preset of presets) expect(typesOf(preset)).toEqual(ACCENT_FIELDS);
    });

    it("sets UP_I18N with the fields of UPI18n", () => {
      const { i18n } = homes.get(name)!;
      expect(typesOf(i18n)).toEqual(I18N_FIELDS);
      const strings = valuesOf(isRecord(i18n) ? i18n.strings : undefined);
      expect(strings.length).toBeGreaterThan(0);
      expect(strings.filter((s) => typeof s !== "string")).toEqual([]);
      const plurals = valuesOf(isRecord(i18n) ? i18n.plurals : undefined);
      expect(plurals.length).toBeGreaterThan(0);
      for (const plural of plurals) {
        expect(typesOf(plural)).toEqual(PLURAL_FIELDS);
        if (!isRecord(plural) || !Array.isArray(plural.forms) || typeof plural.index !== "string") continue;
        const forms: unknown[] = plural.forms;
        expect(forms.length).toBeGreaterThan(0);
        expect(forms.filter((f) => typeof f !== "string")).toEqual([]);
        // Each digit names one of the forms.
        expect(plural.index).toMatch(new RegExp(`^[0-${forms.length - 1}]+$`));
      }
    });
  });

  describe("the example site's island", () => {
    let island: ShellIsland;
    let sh: TestShell;

    beforeAll(() => {
      const parsed = parseShellIsland(homes.get("example")!.island);
      if (!parsed) throw new Error("the example site's island is not a JSON object");
      island = parsed;
      const { since: _, ...rest } = island;
      sh = makeShell({ ...rest, uptime: "0 days" });
    });

    it("carries every optional field", () => {
      expect(island.blog).toBeDefined();
      expect(island.readme).toBeDefined();
      expect(island.solitaire).toBeDefined();
    });

    it("dates the uptime, the posts, and the pages as YYYY-MM-DD", () => {
      expect(island.since).toMatch(DATE);
      expect(island.posts.map((p) => p.date).filter((d) => !DATE.test(d))).toEqual([]);
      expect(island.pages.map((p) => p.date).filter((d) => !DATE.test(d))).toEqual([]);
    });

    it("lists each post in the blog directory", () => {
      const dir = island.blog!.dir;
      const sources = readdirSync(join(example, "content", dir), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith(".md") && !f.endsWith("_index.md"));
      const { stdout } = sh.run(`ls ~/${dir}`);
      expect(stdout.trim().split(/\s+/)).toHaveLength(sources.length);
    });

    it("cats a page's Markdown source", () => {
      expect(sh.run("cat ~/about.md").stdout.trim()).toBe(body(join(example, "content", "about.md")).trim());
    });

    it("cats the home page's Markdown source as the README", () => {
      expect(sh.run("cat ~/README.md").stdout.trim()).toBe(body(join(example, "content", "_index.md")).trim());
    });
  });

  it("writes a bare site's island without the optional fields", () => {
    const island = parseShellIsland(homes.get("bare")!.island);
    expect(island).toMatchObject({ posts: [], pages: [] });
    expect(island).not.toHaveProperty("blog");
    expect(island).not.toHaveProperty("readme");
    expect(island).not.toHaveProperty("solitaire");
  });
});
