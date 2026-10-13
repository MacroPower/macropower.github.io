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
    check: (out) => {
      const sitemap = read(join(out, "sitemap.xml"));
      const home = read(join(out, "index.html"));
      return [
        // The solitaire and icon pages set noindex.
        ...["solitaire", "icons"]
          .filter((p) => sitemap.includes(`/${p}/</loc>`))
          .map((p) => `sitemap.xml lists the noindex page ${p}/`),
        // The home's Markdown body, for crawlers and visitors without JavaScript.
        !/<div class="up-page-body">[\s\S]*<\/div>/.test(home) && "index.html omits the home's content",
      ].filter(Boolean);
    },
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
  [languages.de.params.desktop]
    languageBadge = "DE"
`,
      "content/about.md": page("About"),
      "content/about.de.md": page("Über"),
    },
    check: (out) => [
      !read(join(out, "de/about/index.html")).includes('hreflang="x-default" href="https://example.org/about/"')
        && "de/about/index.html lacks an x-default link to the English page",
      !read(join(out, "de/about/index.html")).includes('class="up-lang-badge" aria-hidden="true">DE<')
        && "de/about/index.html ignores the language's badge",
      !read(join(out, "about/index.html")).includes('class="up-lang-badge" aria-hidden="true">En<')
        && "about/index.html lacks the default En badge",
    ].filter(Boolean),
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
  // A non-English default language whose translation covers one key. The
  // build must say so, and the other strings, in templates and scripts
  // alike, must fall back to English.
  translated: {
    files: {
      "hugo.toml": `${BARE}defaultContentLanguage = "de"\n`,
      "i18n/de.toml": '[home]\nother = "Startseite"\n',
    },
    warns: /the "de" translation lacks \d+ of the theme's i18n keys/,
    check: (out) => {
      const js = readdirSync(join(out, "js")).find((f) => f.startsWith("runtime."));
      const home = read(join(out, "index.html"));
      return [
        !home.includes("Startseite") && "index.html drops the translated home label",
        !home.includes(">Skip to content</a>") && "index.html lacks the English skip link",
        !home.includes("data-trash-count>6 items<") && "the Trash count lacks its English plural",
        (!js || !read(join(out, "js", js)).includes('js_cancel:"Cancel"')) && "the script strings lack their English fallback",
      ].filter(Boolean);
    },
  },
  // Pages published as .html files, where a section's URL ends in
  // index.html.
  ugly: {
    files: {
      "hugo.toml": `${BARE}uglyURLs = true
mainSections = ["posts"]
[[menu.main]]
  identifier = "blog"
  name = "Blog"
  pageRef = "/posts"
`,
      "content/posts/first.md": page("First"),
    },
    check: (out) => [
      !/class="up-launcher-tile is-active"[^>]*data-launcher="blog"/.test(read(join(out, "posts/first.html")))
        && "posts/first.html leaves the Blog launcher tile inactive",
    ].filter(Boolean),
  },
  // A home page in a plain window instead of the terminal.
  homepage: {
    files: {
      "hugo.toml": `${BARE}[params.home]\n  layout = "page"\n`,
      "content/_index.md": page("Welcome"),
    },
    check: (out) => {
      const home = read(join(out, "index.html"));
      return [
        !home.includes("Body of Welcome.") && "index.html omits the home's content",
        home.includes("data-shell") && "index.html still renders the terminal",
        home.includes("/js/shell.") && "index.html still loads the shell bundle",
      ].filter(Boolean);
    },
  },
  // A desktop with its optional parts switched off.
  minimal: {
    files: {
      "hugo.toml": `${BARE}[params.desktop]
  lock  = false
  hud   = false
  trash = false
`,
    },
    check: (out) => {
      const home = read(join(out, "index.html"));
      return [
        home.includes("data-up-lock") && "index.html keeps the lock screen",
        home.includes('"dlg:lock"') && "index.html keeps the Lock action",
        home.includes("data-up-hud") && "index.html keeps the HUD",
        home.includes('data-up-window="trash"') && "index.html keeps the Trash window",
        home.includes("data-launcher-trash") && "index.html keeps the Trash launcher tile",
        home.includes('"dlg:github"') && "index.html offers View source without a repoUrl",
      ].filter(Boolean);
    },
  },
  // An owner named only by an author name that is not a unix login.
  login: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]
[params.author]
  name = "Dr. José Doe"
`,
      "content/posts/one.md": page("One"),
    },
    check: (out) => {
      const post = read(join(out, "posts/one/index.html"));
      return [
        !post.includes("dr@unity:~/posts$") && "posts/one/index.html signs off without the handle dr",
        !post.includes('<div class="up-lock-user">dr</div>') && "the lock screen does not name dr",
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
