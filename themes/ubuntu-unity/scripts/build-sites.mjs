#!/usr/bin/env node
// Builds the sites the theme promises to support, with every Hugo warning
// fatal: the example site, which must use every template, and two bare
// sites that set nothing beyond the theme, one of them multilingual. Run
// it with `npm run test:sites`; it needs only Hugo on PATH.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const theme = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const themesDir = dirname(theme);
const work = mkdtempSync(join(tmpdir(), "ubuntu-unity-sites-"));

const BARE = `baseURL = "https://example.org/"
theme = "ubuntu-unity"
themesDir = ${JSON.stringify(themesDir)}
`;

const MULTILINGUAL = `${BARE}defaultContentLanguage = "en"
[languages.en]
  weight = 1
[languages.de]
  label = "Deutsch"
  weight = 2
`;

// Each site is a Hugo source directory, or the files to write into a fresh one.
const SITES = {
  example: { source: join(theme, "exampleSite"), flags: ["--printUnusedTemplates", "--themesDir", themesDir] },
  bare: { files: { "hugo.toml": BARE } },
  multilingual: {
    files: {
      "hugo.toml": MULTILINGUAL,
      "content/about.md": "+++\ntitle = 'About'\n+++\nHello.\n",
      "content/about.de.md": "+++\ntitle = 'Über'\n+++\nHallo.\n",
    },
  },
};

let failed = false;
try {
  for (const [name, site] of Object.entries(SITES)) {
    let source = site.source;
    if (!source) {
      source = join(work, name);
      for (const [path, body] of Object.entries(site.files)) {
        mkdirSync(dirname(join(source, path)), { recursive: true });
        writeFileSync(join(source, path), body);
      }
    }
    const args = ["--source", source, "--destination", join(work, `${name}-public`),
      "--panicOnWarning", "--printPathWarnings", "--quiet", ...(site.flags ?? [])];
    try {
      execFileSync("hugo", args, { stdio: "inherit" });
      console.log(`ok   ${name}`);
    } catch {
      console.error(`FAIL ${name}`);
      failed = true;
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
