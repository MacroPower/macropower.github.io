#!/usr/bin/env node
// Builds the sites the theme promises to support, with every Hugo warning
// fatal: the example site, which must use every template, and small sites
// that each exercise one shape a consuming site may take. A site's checks
// then read its output for regressions a clean build cannot catch, and a
// link check fails on any link to a file that a site's build lacks. Run
// it with `npm run test:sites`. It needs only Hugo on PATH.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const theme = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const themesDir = dirname(theme);
const work = mkdtempSync(join(tmpdir(), "unity-sites-"));

const config = (baseURL = "https://example.org/"): string => `baseURL = "${baseURL}"
theme = "unity"
themesDir = ${JSON.stringify(themesDir)}
`;
const BARE = config();
const page = (title: string, front = ""): string => `+++\ntitle = '${title}'\n${front}+++\nBody of ${title}.\n`;

// Each site is a Hugo source directory built with extra flags, or the
// files to write into a fresh one. check(out) reads the built site and
// returns a failure message for each failed check and false for each
// passed one. A site with warns builds with warnings allowed. Each of its
// patterns must match a warning, and each warning must match one of its
// patterns. A files site with prepare runs Hugo with those arguments
// against its fresh source before the build, and its check reads what
// that run wrote from the source.
type SiteSpec = ({ source: string; flags?: string[] } | { files: Record<string, string>; prepare?: string[] }) & {
  check?: (out: string, source: string) => (string | false)[];
  warns?: RegExp[];
};

const SITES: Record<string, SiteSpec> = {
  example: {
    source: join(theme, "exampleSite"),
    flags: ["--printUnusedTemplates", "--themesDir", themesDir],
    check: (out) => {
      const sitemap = read(join(out, "sitemap.xml"));
      const home = read(join(out, "index.html"));
      const bundles = readdirSync(join(out, "js"));
      const floor = /\[module\.hugoVersion\]\s+min = "([^"]+)"/.exec(read(join(theme, "hugo.toml")))?.[1];
      return [
        // esbuild keeps only legal comments, so each bundle that inlines a
        // vendored library must carry that library's licence notice.
        ...([["cv", "Mozilla Foundation"], ["shell", "The xterm.js authors"]] as const)
          .filter(([name, notice]) =>
            !bundles.some((f) => f.startsWith(`${name}.`) && read(join(out, "js", f)).includes(notice)))
          .map(([name]) => `js/${name}.*.js lacks the licence notice of the library it inlines`),
        // Hugo reads the version floor from hugo.toml. The guard at the top
        // of baseof.html and README.md's requirements repeat it.
        !floor && "hugo.toml lacks module.hugoVersion.min",
        ...([["layouts/baseof.html", /\$floor := "([^"]+)"/], ["README.md", /^- Hugo (\S+) or later/m]] as const)
          .filter(([file, pattern]) => pattern.exec(read(join(theme, file)))?.[1] !== floor)
          .map(([file]) => `${file} states a Hugo floor other than ${floor}, the one in hugo.toml`),
        // The solitaire and icon pages set noindex.
        ...["solitaire", "icons"]
          .filter((p) => sitemap.includes(`/${p}/</loc>`))
          .map((p) => `sitemap.xml lists the noindex page ${p}/`),
        // The home's Markdown body, for crawlers and visitors without JavaScript.
        !/<div class="up-page-body">[\s\S]*<\/div>/.test(home) && "index.html omits the home's content",
        !read(join(out, "projects/index.html")).includes('href="https://github.com/jane"')
          && "the projects sidebar lacks the GitHub social link",
        // Nothing a Content Security Policy without 'unsafe-inline' blocks.
        ...htmlFiles(out).flatMap((file) => {
          const html = read(file);
          const name = relative(out, file);
          return [
            /<[a-z][^>]*\sstyle="/.test(html) && `${name} has a style attribute`,
            /<style[\s>]/.test(html) && `${name} has a style element`,
            /<[a-z][^>]*\son[a-z]+=/.test(html) && `${name} has an inline event handler`,
            /<script(?![^>]*\ssrc=)(?![^>]*\stype="application\/(?:ld\+)?json")[^>]*>/.test(html) && `${name} has an inline script`,
          ];
        }),
      ];
    },
  },
  // The example site served from a subdirectory, as on a GitHub project
  // page. The link check fails on any link outside /sub/.
  subpath: {
    source: join(theme, "exampleSite"),
    flags: ["--themesDir", themesDir, "--baseURL", "https://example.org/sub/"],
  },
  bare: { files: { "hugo.toml": BARE } },
  // The theme inside a checkout of a larger repository, as in README.md's
  // Git submodule route, where theme names a path under themesDir.
  submodule: {
    files: {
      "hugo.toml": `baseURL = "https://example.org/"
theme = ${JSON.stringify(relative(dirname(themesDir), theme))}
themesDir = ${JSON.stringify(dirname(themesDir))}
`,
    },
  },
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
    ],
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
      ];
    },
  },
  // A site whose own assets and partials use common names. The theme keeps
  // its files under assets/unity/ and layouts/_partials/unity/, so these
  // must not replace any of them.
  clash: {
    files: {
      "hugo.toml": `${BARE}[params.author]\n  name = "Jane Doe"\n`,
      "content/about.md": page("About"),
      "assets/css/main.css": "/* SITE-CSS */ body{color:red}\n",
      "assets/js/app.ts": 'console.log("SITE-JS");\n',
      "assets/icons/launcher/home.svg": '<svg><!-- SITE-ICON --></svg>\n',
      "assets/home/ascii.txt": "SITE-ASCII\n",
      "layouts/_partials/author.html": '<span class="author">PARTIAL-AUTHOR</span>\n',
      "layouts/_partials/icon.html": '<i class="icon">PARTIAL-ICON</i>\n',
      "layouts/_partials/head.html": '<meta name="generator" content="PARTIAL-HEAD">\n',
    },
    check: (out) => {
      const text = (dir: string): string => readdirSync(join(out, dir)).map((f) => read(join(out, dir, f))).join("");
      const css = text("css");
      const pages = read(join(out, "index.html")) + read(join(out, "about/index.html"));
      return [
        (css.includes("SITE-CSS") || !css.includes(".up-top-panel")) && "the site's css/main.css replaced the theme's stylesheet",
        text("js").includes("SITE-JS") && "the site's js/app.ts replaced the theme's script",
        pages.includes("SITE-ICON") && "the site's icons/ replaced a theme icon",
        pages.includes("SITE-ASCII") && "the site's home/ascii.txt replaced the terminal art",
        ...["author", "icon", "head"]
          .filter((name) => pages.includes(`PARTIAL-${name.toUpperCase()}`))
          .map((name) => `the site's _partials/${name}.html replaced the theme's partial`),
        !pages.includes('class="up-top-panel"') && "the pages lack the theme's top panel",
        !pages.includes('"name":"Jane Doe"') && "index.html does not name the author",
      ];
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
      ];
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
      ];
    },
  },
  // A blog that tags its posts, as README.md suggests. The tags take the
  // place of the categories in the Places lenses and the post chips.
  tags: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]
[taxonomies]
  tag = "tags"
[params.blog.taxonomies]
  category = "tags"
`,
      "content/posts/one.md": page("One", "tags = ['go', 'Home Lab']\n"),
    },
    check: (out) => {
      const list = read(join(out, "posts/index.html"));
      return [
        ...["go", "home-lab"]
          .filter((term) => !list.includes(`href="/tags/${term}/"`))
          .map((term) => `posts/index.html has no lens for the tag ${term}`),
        !list.includes('<span class="up-post-chip">#Home Lab</span>') && "posts/index.html lacks the post's tag chip",
        !read(join(out, "tags/home-lab/index.html")).includes('href="/posts/one/"')
          && "tags/home-lab/index.html does not list the tagged post",
      ];
    },
  },
  // A blog without taxonomy pages, feeds, or a sitemap. The link check
  // fails on any lens, feed, or sitemap link that names a missing page.
  trimmed: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]
disableKinds = ["taxonomy", "term", "rss", "sitemap"]
[taxonomies]
  category = "categories"
  series = "series"
`,
      "content/posts/one.md": page("One", "categories = ['meta']\nseries = ['intro']\n"),
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
    warns: [/the "de" translation lacks \d+ of the theme's i18n keys/],
    check: (out) => {
      const js = readdirSync(join(out, "js")).find((f) => f.startsWith("runtime."));
      const home = read(join(out, "index.html"));
      return [
        !home.includes("Startseite") && "index.html drops the translated home label",
        !home.includes(">Skip to content</a>") && "index.html lacks the English skip link",
        !home.includes("data-trash-count>6 items<") && "the Trash count lacks its English plural",
        (!js || !read(join(out, "js", js)).includes('js_cancel:"Cancel"')) && "the script strings lack their English fallback",
      ];
    },
  },
  // Config, data, and front matter that the theme rejects. Each mistake
  // warns, and the build falls back to the default it replaces.
  misconfigured: {
    files: {
      "hugo.toml": `${BARE}[params]
  social = "jane"
[params.desktop]
  accent = "purple"
[params.home]
  layout = "grid"
[params.studio]
  playlist = ["../x.mid"]
`,
      "data/projects.yaml": "- name: named-project\n- description: nameless-project\n",
      "content/cv.md": page("CV", "layout = 'cv'\n"),
    },
    warns: [
      /params\.desktop\.accent "purple" is not /,
      /params\.home\.layout "grid" is not /,
      /params\.social should be a list /,
      /params\.studio\.playlist names "\.\.\/x\.mid", which is not under assets\//,
      /data\/projects has an entry without a name: .*nameless-project/,
      /\/cv\/ uses layout cv but sets no pdf /,
    ],
    check: (out) => {
      const home = read(join(out, "index.html"));
      const cv = read(join(out, "cv/index.html"));
      const dash = readdirSync(join(out, "dash")).map((f) => read(join(out, "dash", f))).join("");
      return [
        home.includes("data-up-accent") && "index.html sets the unknown accent",
        !home.includes("data-shell") && "index.html does not fall back to the terminal",
        home.includes("jane") && "index.html renders the malformed params.social",
        home.includes('data-up-window="daw"') && "index.html keeps the Studio without a playable track",
        !dash.includes("named-project") && "the Dash drops the named project",
        dash.includes("nameless-project") && "the Dash lists the project without a name",
        cv.includes("data-cv-viewer") && "cv/index.html renders the viewer without a pdf",
        !/<div class="up-page-body"><p>Body of CV\./.test(cv) && "cv/index.html omits the page's body",
      ];
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
    ],
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
      ];
    },
  },
  // A Studio playlist that names one track and leaves the other anonymous.
  studio: {
    files: {
      "hugo.toml": `${BARE}[params.studio]
  playlist = [{ path = "midi/a.mid", title = "Opening Theme" }, "midi/b.mid"]
`,
      "assets/midi/a.mid": "MThd",
      "assets/midi/b.mid": "MThd",
    },
    check: (out) => {
      const dash = readdirSync(join(out, "dash")).map((f) => read(join(out, "dash", f))).join("");
      return [
        !dash.includes(">Opening Theme</span>") && "the Dash does not name the titled track",
        !dash.includes(">Track 2</span>") && "the Dash does not number the anonymous track",
      ];
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
      ];
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
      ];
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
    ],
  },
  // A site that collects its modules' Node packages. The theme's
  // package.hugo.json declares none, so the dev tooling in its
  // package.json stays out of the site's npm workspace.
  npmpack: {
    files: { "hugo.toml": BARE },
    prepare: ["mod", "npm", "pack"],
    check: (_out, source) => {
      const pkg: Record<string, Record<string, string> | undefined> =
        JSON.parse(read(join(source, "packages/hugoautogen/package.json")));
      return ["dependencies", "devDependencies"].flatMap((key) =>
        Object.keys(pkg[key] ?? {}).map((name) => `hugo mod npm pack adds ${name} to the site's ${key}`),
      );
    },
  },
  // A site script that imports the theme's script API, built the way
  // README.md shows. The build fails when the import does not resolve.
  api: {
    files: {
      "hugo.toml": BARE,
      "assets/js/site.ts": `import { dialog, notify } from "unity/js/api";
notify({ summary: "SITE-NOTIFY" });
void dialog({ title: "SITE-DIALOG" });
`,
      "layouts/_partials/extend-footer.html": `{{ with resources.Get "js/site.ts" | js.Build (dict "minify" hugo.IsProduction) | fingerprint }}
  <script defer src="{{ .RelPermalink }}" integrity="{{ .Data.Integrity }}"></script>
{{ end }}
`,
    },
    check: (out) => {
      const src = /<script defer src="(\/js\/site\.[0-9a-f]+\.js)"/.exec(read(join(out, "index.html")))?.[1];
      const js = src ? read(join(out, src)) : "";
      return [
        !src && "index.html does not load the site's script",
        ...["up:ready", "up:notify", "SITE-NOTIFY", "SITE-DIALOG"]
          .filter((s) => !js.includes(s))
          .map((s) => `the site's script lacks ${s}`),
      ];
    },
  },
};

function read(file: string): string {
  return readFileSync(file, "utf8");
}

// Runs Hugo and returns whether it succeeded and everything it printed.
// Hugo prints warnings and errors on stderr.
function hugo(args: string[]): { ok: boolean; log: string } {
  const run = spawnSync("hugo", args, { encoding: "utf8" });
  return { ok: run.status === 0, log: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { encoding: "utf8", recursive: true })
    .filter((f) => f.endsWith(".html"))
    .map((f) => join(dir, f));
}

// The site's baseURL, from its --baseURL flag or else its hugo.toml.
function siteBaseURL(source: string, flags: string[]): string {
  const flag = flags.indexOf("--baseURL");
  if (flag >= 0) return flags[flag + 1] ?? "";
  return /^baseURL\s*=\s*"([^"]*)"/m.exec(read(join(source, "hugo.toml")))?.[1] ?? "";
}

// The output files that can hold links. Fonts, images, and the .mjs
// pdf.js worker link nothing on the site.
const LINKING = /\.(?:html|xml|txt|css|js|json|webmanifest)$/;

// Returns a problem for each URL in the built site that names no file in
// it or that lies outside the baseURL's path. A URL that ends in a slash
// names the index.html in that directory. The check reads each absolute
// URL on the baseURL's origin in any text file. It also reads the links
// that htmlLinks finds in an HTML file and the url() values in a CSS
// file. It skips every other origin, such as a sponsor's site or a
// mailto: link.
function brokenLinks(out: string, baseURL: string): string[] {
  const base = new URL(baseURL, "http://localhost/");
  const files = new Set(
    readdirSync(out, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => relative(out, join(d.parentPath, d.name))),
  );
  const found = (path: string): boolean =>
    path.startsWith(base.pathname)
    && [path, posix.join(path, "index.html")].some((p) => files.has(p.slice(base.pathname.length)));
  const onOrigin = new RegExp(`${base.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/[^\\s"'\`<>()\\\\&]*)?`, "g");
  const missing = new Map<string, string[]>();
  for (const name of files) {
    if (!LINKING.test(name)) continue;
    const text = read(join(out, name));
    const at = new URL(name.split("/").map(encodeURIComponent).join("/"), base).href;
    const links = new Set(text.match(onOrigin));
    if (name.endsWith(".html")) for (const link of htmlLinks(text)) links.add(link);
    if (name.endsWith(".css")) for (const m of text.matchAll(/url\(\s*["']?([^"')]+)/g)) links.add(m[1]!);
    for (const link of links) {
      const url = URL.parse(link, at);
      if (url?.origin !== base.origin || found(decodePath(url.pathname))) continue;
      const from = missing.get(url.pathname) ?? [];
      if (!from.includes(name)) missing.set(url.pathname, [...from, name]);
    }
  }
  return [...missing].map(([path, from]) =>
    `${path} ${path.startsWith(base.pathname) ? "is missing from the build" : `lies outside ${base.pathname}`}`
    + `, linked from ${from[0]}${from.length > 1 ? ` and ${from.length - 1} more files` : ""}`);
}

// Hugo percent-encodes the paths it links but writes each file under its
// decoded name.
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// The links in an HTML document's tags: the href, src, srcset, action,
// and poster attributes, and the root-relative strings in data-*
// attributes and JSON blocks. Minification drops the quotes from some
// attribute values.
function htmlLinks(html: string): string[] {
  const links: string[] = [];
  for (const [tag] of html.matchAll(/<[a-z][^>]*>/gi)) {
    for (const m of tag.matchAll(/\s([a-z][a-z-]*)=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      const [, attr = "", ...quoted] = m;
      const value = unescapeHTML(quoted.find((v) => v !== undefined) ?? "");
      if (attr === "srcset") links.push(...value.split(",").map((c) => c.trim().split(/\s+/)[0]!));
      else if (/^(?:href|src|action|poster)$/.test(attr)) links.push(value);
      else if (attr.startsWith("data-")) links.push(...rooted(value));
    }
  }
  for (const m of html.matchAll(/<script[^>]*\stype="?application\/(?:ld\+)?json"?[^>]*>([\s\S]*?)<\/script>/g)) {
    links.push(...rooted(m[1]!));
  }
  return links;
}

// The strings in an attribute value or a JSON text that start with a
// single slash, which the check reads as root-relative URLs.
function rooted(value: string): string[] {
  const isRooted = (v: unknown): v is string => typeof v === "string" && /^\/(?!\/)/.test(v);
  if (isRooted(value)) return [value];
  if (!/^\s*[[{]/.test(value)) return [];
  const found: string[] = [];
  try {
    JSON.parse(value, (_key, v: unknown) => {
      if (isRooted(v)) found.push(v);
      return v;
    });
  } catch {
    return [];
  }
  return found;
}

function unescapeHTML(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };
  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (all, dec?: string, hex?: string, name?: string) =>
    dec ? String.fromCodePoint(Number(dec))
    : hex ? String.fromCodePoint(Number.parseInt(hex, 16))
    : named[name?.toLowerCase() ?? ""] ?? all);
}

let failed = false;
try {
  for (const [name, site] of Object.entries(SITES)) {
    let source: string;
    let flags: string[] = [];
    let prepare: string[] | undefined;
    if ("source" in site) {
      source = site.source;
      flags = site.flags ?? [];
    } else {
      source = join(work, name);
      prepare = site.prepare;
      for (const [path, body] of Object.entries(site.files)) {
        mkdirSync(dirname(join(source, path)), { recursive: true });
        writeFileSync(join(source, path), body);
      }
    }
    const out = join(work, `${name}-public`);
    const args = ["--source", source, "--destination", out,
      "--printPathWarnings", ...(site.warns ? [] : ["--quiet", "--panicOnWarning"]), ...flags];
    const prep = prepare ? hugo([...prepare, "--source", source]) : undefined;
    const run = prep?.ok === false ? prep : hugo(args);
    if (!run.ok) {
      process.stderr.write(run.log);
      console.error(`FAIL ${name}`);
      failed = true;
      continue;
    }
    const problems = [...(site.check?.(out, source) ?? []), ...brokenLinks(out, siteBaseURL(source, flags))]
      .filter((p) => p !== false);
    const warns = site.warns;
    if (warns) {
      const warnings = run.log.split("\n").filter((line) => line.startsWith("WARN"));
      problems.push(
        ...warns.filter((p) => !warnings.some((w) => p.test(w))).map((p) => `no warning matches ${p}`),
        ...warnings.filter((w) => !warns.some((p) => p.test(w))).map((w) => `unexpected warning: ${w}`),
      );
    }
    for (const p of problems) console.error(`     ${name}: ${p}`);
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name}`);
    failed ||= problems.length > 0;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
