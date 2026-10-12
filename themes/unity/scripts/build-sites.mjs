#!/usr/bin/env node
// Builds the sites the theme promises to support, with every Hugo warning
// fatal: the example site, which must use every template, and small sites
// that each exercise one shape a consuming site may take. A site's checks
// then read its output for regressions a clean build cannot catch. Run it
// with `npm run test:sites`. It needs only Hugo on PATH.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const theme = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const themesDir = dirname(theme);
const work = mkdtempSync(join(tmpdir(), "unity-sites-"));

const config = (baseURL = "https://example.org/") => `baseURL = "${baseURL}"
theme = "unity"
themesDir = ${JSON.stringify(themesDir)}
`;
const BARE = config();
const page = (title, front = "") => `+++\ntitle = '${title}'\n${front}+++\nBody of ${title}.\n`;

// Each site is a Hugo source directory, or the files to write into a fresh
// one. check(out) reads the built site and returns a list of failures. A
// site with warns builds with warnings allowed and must print a warning
// matching that pattern.
const SITES = {
  example: {
    source: join(theme, "exampleSite"),
    flags: ["--printUnusedTemplates", "--themesDir", themesDir],
  },
  // The example site served from a subdirectory, as on a GitHub project page.
  subpath: {
    source: join(theme, "exampleSite"),
    flags: ["--themesDir", themesDir, "--baseURL", "https://example.org/sub/"],
    // Minified files such as the Dash fragment drop attribute quotes,
    // and a srcset lists several URLs.
    check: (out) =>
      htmlFiles(out).flatMap((file) =>
        [...read(file).matchAll(/\s(href|src|srcset|action|data-[a-z-]+)=(?:"([^"]*)"|([^\s">]+))/g)]
          .flatMap((m) => (m[1] === "srcset" ? (m[2] ?? m[3]).split(",").map((c) => c.trim().split(" ")[0]) : [m[2] ?? m[3]]))
          .filter((url) => url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/sub/"))
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
  // A section outside mainSections renders as a plain list of its pages.
  notes: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]\n`,
      "content/posts/one.md": page("One"),
      "content/notes/_index.md": page("Notes"),
      "content/notes/first.md": page("First note", "description = 'A short note.'\n"),
    },
    check: (out) => {
      const list = read(join(out, "notes/index.html"));
      return [
        list.includes("data-blog-kind") && "notes/index.html renders as the blog",
        !list.includes("A short note.") && "notes/index.html omits a page's description",
      ].filter(Boolean);
    },
  },
  // A site whose own assets use common names. The theme keeps its files
  // under assets/unity/, so these must not replace any of them.
  clash: {
    files: {
      "hugo.toml": BARE,
      "content/about.md": page("About"),
      "assets/css/main.css": "/* SITE-CSS */ body{color:red}\n",
      "assets/js/app.ts": 'console.log("SITE-JS");\n',
      "assets/icons/launcher/home.svg": '<svg><!-- SITE-ICON --></svg>\n',
      "assets/home/ascii.txt": "SITE-ASCII\n",
    },
    check: (out) => {
      const text = (dir) => readdirSync(join(out, dir)).map((f) => read(join(out, dir, f))).join("");
      const css = text("css");
      const pages = read(join(out, "index.html")) + read(join(out, "about/index.html"));
      return [
        (css.includes("SITE-CSS") || !css.includes(".up-top-panel")) && "the site's css/main.css replaced the theme's stylesheet",
        text("js").includes("SITE-JS") && "the site's js/app.ts replaced the theme's script",
        pages.includes("SITE-ICON") && "the site's icons/ replaced a theme icon",
        pages.includes("SITE-ASCII") && "the site's home/ascii.txt replaced the terminal art",
      ].filter(Boolean);
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
      "content/posts/top.md": page("Top post", "date = 2025-01-01\n"),
      "content/posts/2024/_index.md": page("2024"),
      "content/posts/2024/deep.md": page("Deep post", "date = 2024-01-01\n"),
    },
    check: (out) => {
      const list = read(join(out, "posts/index.html"));
      const deep = read(join(out, "posts/2024/deep/index.html"));
      return [
        !list.includes("Deep post") && "posts/index.html omits the nested post",
        !deep.includes('class="up-pathbar-btn" href="/posts/"') && "the nested post's pathbar omits the blog section",
        !deep.includes('href="/posts/top/"') && "the nested post has no arrow to the newer post outside its section",
      ].filter(Boolean);
    },
  },
  // A non-English default language whose translation covers one key.
  // Hugo renders the other template strings empty, so the build must say
  // so, and the scripts' strings must fall back to English.
  translated: {
    files: {
      "hugo.toml": `${BARE}defaultContentLanguage = "de"\n`,
      "i18n/de.toml": '[home]\nother = "Startseite"\n',
    },
    warns: /the "de" translation lacks \d+ of the theme's i18n keys/,
    check: (out) => {
      const js = readdirSync(join(out, "js")).find((f) => f.startsWith("i18n."));
      return [
        (!js || !read(join(out, "js", js)).includes('js_cancel:"Cancel"')) && "the script strings lack their English fallback",
      ].filter(Boolean);
    },
  },
  // Config, front matter, and data in the looser shapes Hugo accepts.
  loose: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]
[params]
  social = { github = "https://github.com/jane" }
[taxonomies]
  category = "categories"
`,
      "content/posts/one.md": page("One", "categories = 'solo'\n"),
      "content/posts/two.md": page("Two", "categories = ['a', 'b']\n"),
      "data/projects.yaml": "- name: bare-project\n- name: tagged\n  language: Go\n  topics: [cli]\n",
    },
    check: (out) => [
      !read(join(out, "index.html")).includes("github.com/jane") && "the home page drops a map-form params.social",
    ].filter(Boolean),
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
      "--printPathWarnings", ...(site.warns ? [] : ["--quiet", "--panicOnWarning"]), ...(site.flags ?? [])];
    // Hugo prints warnings and errors on stderr.
    const run = spawnSync("hugo", args, { encoding: "utf8" });
    const log = `${run.stdout ?? ""}${run.stderr ?? ""}`;
    if (run.status !== 0) {
      process.stderr.write(log);
      console.error(`FAIL ${name}`);
      failed = true;
      continue;
    }
    const problems = site.check?.(out) ?? [];
    if (site.warns && !site.warns.test(log)) problems.push(`no warning matches ${site.warns}`);
    for (const p of problems) console.error(`     ${name}: ${p}`);
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name}`);
    failed ||= problems.length > 0;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
