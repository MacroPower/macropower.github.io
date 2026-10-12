#!/usr/bin/env node
// Builds the sites the theme promises to support, with every Hugo warning
// fatal: the example site, which must use every template, and small sites
// that each exercise one shape a consuming site may take. A site's checks
// then read its output for regressions a clean build cannot catch. Run it
// with `npm run test:sites`. It needs only Hugo on PATH.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const theme = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const themesDir = dirname(theme);
const work = mkdtempSync(join(tmpdir(), "ubuntu-unity-sites-"));

const config = (baseURL = "https://example.org/") => `baseURL = "${baseURL}"
theme = "ubuntu-unity"
themesDir = ${JSON.stringify(themesDir)}
`;
const BARE = config();
const page = (title, front = "") => `+++\ntitle = '${title}'\n${front}+++\nBody of ${title}.\n`;

// Each site is a Hugo source directory, or the files to write into a fresh
// one. check(out) reads the built site and returns a list of failures.
const SITES = {
  example: {
    source: join(theme, "exampleSite"),
    flags: ["--printUnusedTemplates", "--themesDir", themesDir],
  },
  // The example site served from a subdirectory, as on a GitHub project page.
  subpath: {
    source: join(theme, "exampleSite"),
    flags: ["--themesDir", themesDir, "--baseURL", "https://example.org/sub/"],
    check: (out) =>
      htmlFiles(out).flatMap((file) =>
        [...read(file).matchAll(/\s(?:href|src|action)="(\/[^"]*)"/g)]
          .map((m) => m[1])
          .filter((url) => !url.startsWith("/sub/"))
          .map((url) => `${relative(out, file)} links ${url} outside /sub/`),
      ),
  },
  bare: { files: { "hugo.toml": BARE } },
  multilingual: {
    files: {
      "hugo.toml": `${BARE}defaultContentLanguage = "en"
[languages.en]
  weight = 1
[languages.de]
  label = "Deutsch"
  weight = 2
`,
      "content/about.md": page("About"),
      "content/about.de.md": page("Über"),
    },
  },
  // Root pages only. Hugo then sets mainSections to [""], which must not
  // turn every root page into a blog post.
  sectionless: {
    files: { "hugo.toml": BARE, "content/about.md": page("About"), "content/now.md": page("Now") },
    check: (out) => {
      const about = read(join(out, "about/index.html"));
      return [
        about.includes("data-blog-kind") && "about/index.html renders as a blog post",
        about.includes("BlogPosting") && "about/index.html carries BlogPosting JSON-LD",
        read(join(out, "index.xml")).includes("<item>") && "index.xml lists root pages as posts",
      ].filter(Boolean);
    },
  },
  // Posts in a nested section.
  nested: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]\n`,
      "content/posts/_index.md": page("Posts"),
      "content/posts/top.md": page("Top post"),
      "content/posts/2024/_index.md": page("2024"),
      "content/posts/2024/deep.md": page("Deep post"),
    },
    check: (out) => {
      const list = read(join(out, "posts/index.html"));
      const deep = read(join(out, "posts/2024/deep/index.html"));
      return [
        !list.includes("Deep post") && "posts/index.html omits the nested post",
        !deep.includes('href="/posts/"') && "the nested post's pathbar omits the blog section",
      ].filter(Boolean);
    },
  },
};

function read(file) {
  return readFileSync(file, "utf8");
}

function htmlFiles(dir) {
  return readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith(".html"))
    .map((f) => join(dir, f));
}

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
    const out = join(work, `${name}-public`);
    const args = ["--source", source, "--destination", out,
      "--panicOnWarning", "--printPathWarnings", "--quiet", ...(site.flags ?? [])];
    try {
      execFileSync("hugo", args, { stdio: "inherit" });
    } catch {
      console.error(`FAIL ${name}`);
      failed = true;
      continue;
    }
    const problems = site.check?.(out) ?? [];
    for (const p of problems) console.error(`     ${name}: ${p}`);
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name}`);
    failed ||= problems.length > 0;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
