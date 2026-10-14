#!/usr/bin/env node
// Builds the sites the theme promises to support, with every Hugo warning
// fatal: the example site, which must use every template, and small sites
// that each exercise one shape a consuming site may take. A site's checks
// then read its output for regressions a clean build cannot catch, and a
// link check fails on any link to a file that a site's build lacks. Run
// it with `npm run test:sites`. It needs only Hugo on PATH.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

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
// that run wrote from the source. A reproducible site builds a second
// time and must write the same files byte for byte.
type SiteSpec = ({ source: string; flags?: string[] } | { files: Record<string, string>; prepare?: string[] }) & {
  check?: (out: string, source: string) => (string | false)[];
  warns?: RegExp[];
  reproducible?: boolean;
};

const SITES: Record<string, SiteSpec> = {
  example: {
    source: join(theme, "exampleSite"),
    flags: ["--printUnusedTemplates", "--themesDir", themesDir],
    reproducible: true,
    check: (out) => {
      const sitemap = read(join(out, "sitemap.xml"));
      const home = read(join(out, "index.html"));
      const bundles = readdirSync(join(out, "js"));
      const floor = /\[module\.hugoVersion\]\s+min = "([^"]+)"/.exec(read(join(theme, "hugo.toml")))?.[1];
      const current = (file: string): string =>
        [...read(join(out, file)).matchAll(/class="up-launcher-tile is-active"[^>]*data-launcher="([a-z]+)"/g)]
          .map((m) => m[1]).join(" ");
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
        !read(join(out, "about/index.html")).includes('<a class="up-menu-item" href="/privacy/"')
          && "the Help menu lacks the menu.help link to the privacy page",
        // The chrome renders once per language around the parts that follow
        // the page: the panel's title and the launcher's current tiles.
        ...Object.entries({ "index.html": "home", "about/index.html": "", "cv/index.html": "cv",
          "posts/index.html": "blog", "solitaire/index.html": "solitaire" })
          .filter(([file, keys]) => current(file) !== keys)
          .map(([file, keys]) => `${file} marks the launcher tiles "${current(file)}" current, not "${keys}"`),
        ...htmlFiles(out).map((file) => {
          const html = read(file);
          const panel = /data-panel-slot="title">\s*([^<]*?)\s*</.exec(html)?.[1];
          const titlebar = /class="up-titlebar-text">([^<]*)</.exec(html)?.[1];
          return panel !== titlebar && `${relative(out, file)} titles its panel "${panel}" and its window "${titlebar}"`;
        }),
        ...htmlFiles(out).flatMap((file) => panelAriaProblems(relative(out, file), read(file))),
        ...htmlFiles(out).flatMap((file) => exposedSvgs(relative(out, file), read(file))),
        ...htmlFiles(out).flatMap((file) => duplicateIds(relative(out, file), read(file))),
        ...htmlFiles(out).flatMap((file) => bundleMismatches(relative(out, file), read(file))),
        // The launcher's full-color art loads as images, so it stays out
        // of every page's HTML.
        read(join(out, "about/index.html")).includes("<linearGradient") && "about/index.html inlines gradient art",
        ...iconImages(out).filter((src) => !isSvgFile(join(out, src))).map((src) => `${src} is not a standalone SVG`),
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
  bare: {
    files: { "hugo.toml": BARE },
    check: (out) => {
      const names = accentNames(out);
      return [
        !read(join(out, "index.html")).includes('data-up-accent="orange"') && "index.html does not start with the orange accent",
        names !== "orange green aubergine blue" && `the Preferences dialog offers ${names}, not the theme's presets`,
      ];
    },
  },
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
[[menus.help]]
  name = "Imprint"
  pageRef = "/imprint"
  weight = 1
[[menus.help]]
  name = "Contact"
  url = "/contact/"
  weight = 2
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
      "content/imprint.md": page("Imprint"),
      "content/contact.md": page("Contact"),
      "content/contact.de.md": page("Kontakt"),
      "i18n/de.toml": '[menu_file]\nother = "Datei"\n[messages]\nother = "Nachrichten"\n',
    },
    check: (out) => [
      // The panel's menus and indicators render once per language.
      ...["index.html", "about/index.html", "de/index.html", "de/about/index.html"].flatMap((file) => {
        const html = read(join(out, file));
        const [menu, indicator] = file.startsWith("de/") ? ["Datei", "Nachrichten"] : ["File", "Messages"];
        return [
          !html.includes(`aria-expanded="false">${menu}</button>`) && `${file} lacks the ${menu} menu`,
          !html.includes(`<div class="up-dropdown-header">${indicator}</div>`) && `${file} lacks the ${indicator} indicator`,
        ];
      }),
      !read(join(out, "de/about/index.html")).includes('hreflang="x-default" href="https://example.org/about/"')
        && "de/about/index.html lacks an x-default link to the English page",
      !read(join(out, "de/about/index.html")).includes('class="up-lang-badge" aria-hidden="true">DE<')
        && "de/about/index.html ignores the language's badge",
      !read(join(out, "about/index.html")).includes('class="up-lang-badge" aria-hidden="true">En<')
        && "about/index.html lacks the default En badge",
      ...panelAriaProblems("de/about/index.html", read(join(out, "de/about/index.html"))),
      // The Help menu lists menu.help by weight. A url entry gets the
      // language prefix, and a pageRef entry with no page in the language
      // stays out of that language's menu.
      ...Object.entries({ "index.html": ["/imprint/", "/contact/"], "de/index.html": ["/de/contact/"] })
        .flatMap(([file, hrefs]) => {
          const links = [...read(join(out, file)).matchAll(/<a class="up-menu-item" href="([^"]*)"/g)]
            .map((m) => m[1]).join(" ");
          return links !== hrefs.join(" ") && `${file} links the Help menu to "${links}", not "${hrefs.join(" ")}"`;
        }),
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
        (pages + iconImages(out).map((src) => read(join(out, src))).join("")).includes("SITE-ICON")
          && "the site's icons/ replaced a theme icon",
        pages.includes("SITE-ASCII") && "the site's home/ascii.txt replaced the terminal art",
        ...["author", "icon", "head"]
          .filter((name) => pages.includes(`PARTIAL-${name.toUpperCase()}`))
          .map((name) => `the site's _partials/${name}.html replaced the theme's partial`),
        !pages.includes('class="up-top-panel"') && "the pages lack the theme's top panel",
        !pages.includes('"name":"Jane Doe"') && "index.html does not name the author",
      ];
    },
  },
  // A site that uses every documented hook. Its custom.css imports an
  // external stylesheet and a sibling file, nests a rule, and sets the
  // wallpaper token to an image beside it. Each extend-*
  // partial holds an element marker, because `html/template` drops HTML
  // comments.
  hooks: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]\n`,
      "content/about.md": page("About"),
      "content/posts/one.md": page("One"),
      "assets/css/custom.css": `@import url("https://fonts.example.org/hooks.css");
@import "extra.css";
.hooks-custom{order:1;.hooks-nested{order:2}}
:root{--up-wallpaper:url("wall.png") center/cover}
`,
      "assets/css/extra.css": ".hooks-extra{order:3}\n",
      "assets/css/wall.png": "PNG",
      "layouts/_partials/extend-head.html": '<meta name="hooks" content="HEAD-HOOK">\n',
      "layouts/_partials/extend-footer.html": "<span hidden>FOOTER-HOOK</span>\n",
      "layouts/_partials/extend-post.html": "<p>POST-HOOK {{ .Title }}</p>\n",
    },
    check: (out) => {
      const pages = ["index.html", "about/index.html", "posts/one/index.html"].map((p) => [p, read(join(out, p))] as const);
      const href = /<link rel="stylesheet" href="([^"]+)"/.exec(pages[0]![1])?.[1];
      const css = href ? read(join(out, href)) : "";
      const imported = css.search(/\.hooks-extra\s*\{/);
      // Unlowered nesting never puts the two classes side by side.
      const nested = css.search(/\.hooks-custom \.hooks-nested\s*\{/);
      const wall = /--up-wallpaper:\s*url\("?([^")]+)"?\)/.exec(css);
      const post = pages[2]![1];
      return [
        // Browsers ignore an @import after any rule other than @charset or
        // an @layer statement.
        !/^@layer unity\.theme,\s*unity\.chroma;\s*@import\s*(?:url\()?"https:\/\/fonts\.example\.org\/hooks\.css"/.test(css)
          && "the stylesheet does not open with the layer order and then custom.css's external @import",
        layerAt(css, css.indexOf(".up-top-panel")) !== "unity.theme" && "the theme's rules sit outside the unity.theme layer",
        // The lookbehind skips the layer's own name in "@layer unity.chroma{".
        layerAt(css, css.search(/(?<=[{}])\.chroma\s*\{/)) !== "unity.chroma" && "the highlighter's rules sit outside the unity.chroma layer",
        (imported < 0 || layerAt(css, imported) !== "") && "the stylesheet lacks the file custom.css imports, unlayered",
        (nested < 0 || layerAt(css, nested) !== "") && "the stylesheet lacks custom.css's nested rule, lowered and unlayered",
        !(wall && layerAt(css, wall.index) === "" && existsSync(join(out, wall[1]!)))
          && "the stylesheet lacks custom.css's wallpaper, unlayered, with its image published",
        ...pages.flatMap(([name, html]) => {
          const head = html.indexOf('content="HEAD-HOOK"');
          const foot = html.indexOf("FOOTER-HOOK");
          return [
            !(head > html.indexOf('rel="stylesheet"') && head < html.indexOf("</head>"))
              && `${name} lacks extend-head.html between the stylesheet and </head>`,
            !(foot > html.lastIndexOf("<script") && foot < html.indexOf("</body>"))
              && `${name} lacks extend-footer.html between the last script and </body>`,
          ];
        }),
        !(post.indexOf("POST-HOOK One") > post.indexOf("Body of One.")) && "posts/one/index.html lacks extend-post.html after the body",
        pages[1]![1].includes("POST-HOOK") && "about/index.html renders extend-post.html",
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
  indicators = ["clock", "nope"]
[params.desktop.accents.pale]
  label = "Pale"
[params.desktop.accents."sea green"]
  color = "#2E8B57"
[params.home]
  layout = "grid"
[params.studio]
  playlist = ["../x.mid"]
`,
      "data/projects.yaml": "- name: named-project\n- description: nameless-project\n",
      "content/cv.md": page("CV", "layout = 'cv'\n"),
    },
    warns: [
      /params\.desktop\.accent "purple" names no preset /,
      /params\.desktop\.accents\.pale has no color/,
      /params\.desktop\.accents\.sea green has a name with characters other than /,
      /params\.desktop\.indicators names "nope", but /,
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
        !home.includes('data-up-accent="orange"') && "index.html does not fall back to the orange accent",
        accentNames(out) !== "orange green aubergine blue"
          && `the Preferences dialog offers ${accentNames(out)}, not the theme's presets alone`,
        !home.includes('data-indicator="clock"') && "index.html drops the clock beside the unknown indicator",
        !home.includes("data-shell") && "index.html does not fall back to the terminal",
        home.includes("jane") && "index.html renders the malformed params.social",
        home.includes('data-up-window="daw"') && "index.html keeps the Studio without a playable track",
        !dash.includes("named-project") && "the Dash drops the named project",
        dash.includes("nameless-project") && "the Dash lists the project without a name",
        cv.includes("data-cv-viewer") && "cv/index.html renders the viewer without a pdf",
        ...bundleMismatches("cv/index.html", cv),
        !/<div class="up-page-body"><p>Body of CV\./.test(cv) && "cv/index.html omits the page's body",
      ];
    },
  },
  // A right-to-left default language without a translation of its own.
  // Each page sets dir="rtl" on <html>, which the stylesheet's logical
  // properties and [dir="rtl"] rules follow.
  rtl: {
    files: {
      "hugo.toml": `${BARE}defaultContentLanguage = "ar"
mainSections = ["posts"]
ignoreLogs = ["unity-i18n-missing"]
[languages.ar]
  direction = "rtl"
`,
      "content/posts/one.md": page("One"),
    },
    check: (out) =>
      ["index.html", "posts/index.html", "posts/one/index.html"]
        .filter((p) => !/<html [^>]*\bdir="rtl"/.test(read(join(out, p))))
        .map((p) => `${p} lacks dir="rtl" on <html>`),
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
  // The theme's page partials under layouts that the site names, and a
  // post whose own layout renders no post reader.
  renamed: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]\n`,
      "content/about.md": page("About"),
      "content/work.md": page("Work", "layout = 'portfolio'\n"),
      "content/resume.md": page("Resume", "layout = 'resume'\npdf = 'https://example.com/cv.pdf'\n"),
      "content/game.md": page("Game", "layout = 'cards'\n"),
      "content/posts/one.md": page("One"),
      "content/posts/note.md": page("Note", "layout = 'plain'\n"),
      "layouts/portfolio.html": '{{ define "main" }}{{ partial "unity/page/projects.html" . }}{{ end }}\n',
      "layouts/resume.html": '{{ define "main" }}{{ partial "unity/page/cv.html" . }}{{ end }}\n',
      "layouts/cards.html": '{{ define "main" }}{{ partial "unity/page/solitaire.html" . }}{{ end }}\n',
      "layouts/plain.html": '{{ define "main" }}{{ .Content }}{{ end }}\n',
    },
    check: (out) => [
      ...Object.entries({ "work/index.html": "projects", "resume/index.html": "cv", "game/index.html": "solitaire" })
        .filter(([file, bundle]) => !bundles(read(join(out, file))).includes(bundle))
        .map(([file, bundle]) => `${file} does not load the ${bundle} bundle`),
      ...htmlFiles(out).flatMap((file) => bundleMismatches(relative(out, file), read(file))),
    ],
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
  indicators = ["network", "clock", "user"]
`,
    },
    check: (out) => {
      const home = read(join(out, "index.html"));
      return [
        ...["inbox", "vol", "bat"]
          .filter((key) => home.includes(`data-indicator="${key}"`))
          .map((key) => `index.html keeps the ${key} indicator`),
        home.includes("data-up-lock") && "index.html keeps the lock screen",
        home.includes('"dlg:lock"') && "index.html keeps the Lock action",
        home.includes("data-up-hud") && "index.html keeps the HUD",
        home.includes('data-up-window="trash"') && "index.html keeps the Trash window",
        home.includes("data-launcher-trash") && "index.html keeps the Trash launcher tile",
        home.includes('"dlg:github"') && "index.html offers View source without a repoUrl",
      ];
    },
  },
  // A wallpaper image under assets/ on a site served from a subdirectory.
  // The build must publish the image under the subdirectory.
  wallpaper: {
    files: {
      "hugo.toml": `${config("https://example.org/sub/")}[params.desktop]\n  wallpaper = "images/wall.png"\n`,
      "assets/images/wall.png": "PNG",
    },
    check: (out) => wallpaperCheck(out, (url) =>
      !(url.startsWith("/sub/") && existsSync(join(out, url.slice("/sub/".length))))
        && `the wallpaper rule names ${url}, which the build did not publish under /sub/`),
  },
  // A wallpaper under static/, which css.Build must leave as written
  // apart from the subdirectory.
  wallstatic: {
    files: {
      "hugo.toml": `${config("https://example.org/sub/")}[params.desktop]\n  wallpaper = "/img/wall.png"\n`,
      "static/img/wall.png": "PNG",
    },
    check: (out) => wallpaperCheck(out, (url) =>
      url !== "/sub/img/wall.png" && `the wallpaper rule names ${url}, not /sub/img/wall.png`),
  },
  // Accent presets of the site's own merged into the theme's: one with a
  // label, a weight, and a light shade, and one with only a color. The
  // site removes a built-in preset and names its starting preset in
  // another case.
  accents: {
    files: {
      "hugo.toml": `${BARE}[params.desktop]
  accent = "Brand"
  accents.green = false
[params.desktop.accents.brand]
  color  = "#0E8420"
  light  = "#13A52A"
  label  = "Brand Green"
  weight = 15
[params.desktop.accents.teal]
  color = "#00897B"
`,
    },
    check: (out) => {
      const labels = upSite(out).accents?.map((a) => `${a.name}=${a.label}`).join(" ");
      const brand = accentRule(out, "brand");
      const teal = accentRule(out, "teal");
      return [
        !read(join(out, "index.html")).includes('data-up-accent="brand"') && "index.html does not start with the brand accent",
        labels !== "orange=Orange brand=Brand Green aubergine=Aubergine blue=Blue teal=teal"
          && `the Preferences dialog offers ${labels}, not the merged presets in weight order`,
        accentRule(out, "green") !== undefined && "the stylesheet keeps the removed green preset",
        !brand?.includes(flat("--up-accent:#0E8420;--up-accent-light:#13A52A;--up-accent-dark:color-mix(in srgb, #0E8420 80%, black)"))
          && "the stylesheet lacks the brand preset's rule with its light shade and a mixed dark shade",
        !teal?.includes(flat("--up-accent-light:color-mix(in srgb, #00897B 85%, white)"))
          && "the stylesheet lacks the teal preset's rule with a mixed light shade",
      ];
    },
  },
  // Indicators in a site's own order, one of them the site's own partial
  // and one of them a name with no partial.
  indicators: {
    files: {
      "hugo.toml": `${BARE}title = "Forecast"
[params.desktop]
  indicators = ["clock", "weather", "nope"]
`,
      "content/about.md": page("About"),
      "layouts/_partials/unity/indicators/weather.html":
        '<div class="up-panel-item" data-indicator="weather">{{ .Title }}</div>\n',
    },
    warns: [/params\.desktop\.indicators names "nope"/],
    check: (out) => {
      const home = read(join(out, "index.html"));
      const keys = [...home.matchAll(/data-indicator="([a-z]+)"/g)].map((m) => m[1]).join(" ");
      return [
        keys !== "clock weather" && `index.html renders the indicators "${keys}", not "clock weather"`,
        !read(join(out, "about/index.html")).includes('data-indicator="weather">Forecast<')
          && "the site's indicator does not get the site as its context",
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
  // Menu icons a site adds under assets/unity/icons/: full-color art
  // whose file omits the SVG namespace, and a glyph that paints with
  // currentColor.
  icons: {
    files: {
      "hugo.toml": `${BARE}[[menus.main]]
  identifier = "art"
  name = "Art"
  url = "/art/"
  [menus.main.params]
    icon = "launcher/site-art"
[[menus.main]]
  identifier = "tint"
  name = "Tint"
  url = "/tint/"
  [menus.main.params]
    icon = "glyphs/site-tint"
`,
      "content/art.md": page("Art"),
      "content/tint.md": page("Tint"),
      "assets/unity/icons/launcher/site-art.svg": '<svg viewBox="0 0 48 48"><rect width="48" height="48" fill="#E95420"/></svg>\n',
      "assets/unity/icons/glyphs/site-tint.svg": '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>\n',
    },
    check: (out) => {
      const home = read(join(out, "index.html"));
      const tile = (key: string): string => new RegExp(`data-launcher="${key}"[^>]*>\\s*<span class="up-launcher-icon">(<[a-z]+[^>]*>)`).exec(home)?.[1] ?? "";
      const src = /^<img src="([^"]+)"/.exec(tile("art"))?.[1];
      return [
        !src && `the Art tile renders ${tile("art") || "no icon"}, not an image`,
        src !== undefined && !isSvgFile(join(out, src)) && `the Art tile's ${src} is not a standalone SVG`,
        !tile("tint").startsWith('<svg aria-hidden="true"') && `the Tint tile renders ${tile("tint") || "no icon"}, not its inline glyph`,
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

// The cascade layer whose block holds offset i of a stylesheet, or "" when
// no @layer block holds it or i is negative.
function layerAt(css: string, i: number): string {
  if (i < 0) return "";
  const open: string[] = [];
  // Blank the quoted strings, whose braces do not open or close a block.
  for (const m of css.slice(0, i).replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').matchAll(/@layer\s+([\w.-]+)\s*\{|[{}]/g)) {
    if (m[0] === "}") open.pop();
    else open.push(m[1] ?? "");
  }
  return open.filter(Boolean).at(-1) ?? "";
}

// Checks the image that params.desktop.wallpaper puts in the stylesheet
// that index.html links, on a site served from /sub/. The stylesheet must
// declare --up-wallpaper twice in the unity.theme layer, main.css's
// default first and the param's image second, so the image beats the
// default and custom.css beats the image. expect(url) checks the image's
// URL.
function wallpaperCheck(out: string, expect: (url: string) => string | false): (string | false)[] {
  const href = /<link rel="stylesheet" href="\/sub\/([^"]+)"/.exec(read(join(out, "index.html")))?.[1];
  const css = href ? read(join(out, href)) : "";
  const decls = [...css.matchAll(/--up-wallpaper:\s*([^;}]+)/g)];
  const url = decls.length === 2 && decls.every((m) => layerAt(css, m.index) === "unity.theme")
    ? /^url\("?([^")]+)"?\) center\/cover no-repeat$/.exec(decls[1]![1]!.trim())?.[1]
    : undefined;
  return [url === undefined ? "the stylesheet lacks the wallpaper param's rule after main.css's default in the unity.theme layer" : expect(url)];
}

// The window.UP_SITE that the runtime script index.html loads sets.
function upSite(out: string): { accents?: { name: string; label: string }[] } {
  const src = /<script defer src="([^"]+\/runtime\.[^"]+)"/.exec(read(join(out, "index.html")))?.[1];
  const window: { UP_SITE?: { accents?: { name: string; label: string }[] } } = {};
  if (src) runInNewContext(read(join(out, src)), { window });
  return window.UP_SITE ?? {};
}

// The names of the accent presets that the Preferences dialog offers, in
// order and separated by spaces.
function accentNames(out: string): string {
  return upSite(out).accents?.map((a) => a.name).join(" ") ?? "";
}

// A declaration list without whitespace and in lowercase, as minified
// CSS might write it.
function flat(css: string): string {
  return css.replace(/\s+/g, "").toLowerCase();
}

// The declarations, flattened, of the unity.theme rule that sets an
// accent preset's tokens on <html> and its swatch, in the stylesheet that
// index.html links. undefined when the stylesheet lacks the rule.
function accentRule(out: string, name: string): string | undefined {
  const href = /<link rel="stylesheet" href="([^"]+)"/.exec(read(join(out, "index.html")))?.[1];
  const css = href ? read(join(out, href)) : "";
  const attr = `\\[data-up-accent="?${name}"?\\]`;
  const m = new RegExp(`:root${attr},\\s*\\.up-accent-swatch${attr}\\s*\\{([^}]*)\\}`).exec(css);
  return m && layerAt(css, m.index) === "unity.theme" ? flat(m[1]!) : undefined;
}

// The panel's File, Edit, View, and Help menus follow the ARIA menu button
// pattern, and its indicators follow the disclosure pattern. Each trigger
// names its dropdown through aria-controls. Only a menu trigger announces
// a popup, and its dropdown has role="menu". Every menu row carries a menu
// item role that states its checked and disabled flags.
function panelAriaProblems(name: string, html: string): string[] {
  const tags = [...html.matchAll(/<[a-z][^>]*>/g)].map((m) => m[0]);
  const attr = (tag: string, key: string): string | undefined =>
    new RegExp(`\\s${key}="([^"]*)"`).exec(tag)?.[1];
  const byId = new Map(tags.flatMap((tag) => {
    const id = attr(tag, "id");
    return id ? [[id, tag] as const] : [];
  }));
  return tags.flatMap((tag): string[] => {
    const menu = attr(tag, "data-menu");
    const key = menu ?? attr(tag, "data-indicator");
    if (key !== undefined && tag.includes(" data-panel-trigger")) {
      const controls = attr(tag, "aria-controls");
      const target = controls === undefined ? undefined : byId.get(controls);
      const popup = attr(tag, "aria-haspopup");
      if (!target) return [`${name}: the ${key} trigger controls no element on the page`];
      if (menu === undefined) {
        return popup === undefined ? [] : [`${name}: the ${key} indicator announces a ${popup} popup`];
      }
      return [
        popup !== "menu" && `${name}: the ${key} menu announces a ${popup} popup, not a menu`,
        attr(target, "role") !== "menu" && `${name}: the ${key} menu's dropdown lacks role="menu"`,
        attr(target, "aria-labelledby") !== attr(tag, "id") && `${name}: the ${key} menu is not labelled by its trigger`,
      ].filter((p) => p !== false);
    }
    const cls = attr(tag, "class")?.split(" ") ?? [];
    if (!cls.includes("up-menu-item")) return [];
    const label = `${name}: the menu row ${tag}`;
    return [
      attr(tag, "role") !== (cls.includes("has-check") ? "menuitemcheckbox" : "menuitem") && `${label} has the wrong role`,
      cls.includes("has-check") && attr(tag, "aria-checked") !== "true" && `${label} is not aria-checked`,
      cls.includes("is-disabled") && attr(tag, "aria-disabled") !== "true" && `${label} is not aria-disabled`,
    ].filter((p) => p !== false);
  });
}

// Every SVG on a page decorates a control that names itself. Each one
// must sit under aria-hidden="true", on itself or on an ancestor. A named
// image (role="img" with an aria-label) passes too. Minified files drop
// the quotes around a plain attribute value. The walk skips comments,
// scripts, and styles, and it never pushes a void or self-closed tag. An
// end tag pops the stack to its start tag, so it also closes the tags
// inside that a minifier left open.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
function exposedSvgs(name: string, html: string): string[] {
  const body = markup(html);
  const stack: { tag: string; hidden: boolean }[] = [];
  const problems: string[] = [];
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const [, end, rawTag, attrs] = m;
    const tag = rawTag!.toLowerCase();
    if (end) {
      const at = stack.findLastIndex((e) => e.tag === tag);
      if (at !== -1) stack.length = at;
      continue;
    }
    const hidden = (stack.at(-1)?.hidden ?? false) || /\saria-hidden="?true\b/.test(attrs!);
    if (tag === "svg" && !hidden && !(/\srole="?img\b/.test(attrs!) && /\saria-label="?[^"\s>]/.test(attrs!))) {
      problems.push(`${name} exposes an unnamed <svg${attrs!.slice(0, 60)}>`);
    }
    if (!VOID.has(tag) && !attrs!.endsWith("/")) stack.push({ tag, hidden });
  }
  return problems;
}

// An id names one element of its page. A document resolves a reference
// such as url(#id) to the first element with that id. A second inline
// copy of an icon then paints with the first copy's gradients, and with
// none when the first copy sits in a hidden subtree.
function duplicateIds(name: string, html: string): string[] {
  const ids = [...markup(html).matchAll(/<[a-zA-Z][^>]*?\sid=(?:"([^"]*)"|([^\s>"']+))/g)].map((m) => m[1] ?? m[2]!);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    .map((id) => `${name} gives the id ${id} to more than one element`);
}

// The bundles a page loads, by the name of their published file.
function bundles(html: string): string[] {
  return [...html.matchAll(/<script[^>]*\ssrc="?[^"\s>]*\/js\/([a-z]+)\./g)].map((m) => m[1]!);
}

// Each page bundle no-ops without its root element, so a page loads the
// bundle exactly when it renders the root.
const BUNDLE_ROOTS: Record<string, string> = {
  blog: "data-blog-kind", cv: "data-cv-viewer", icons: "data-icon-vault",
  projects: "data-projects-kind", shell: "data-shell", solitaire: "data-solitaire",
};
function bundleMismatches(name: string, html: string): string[] {
  const body = markup(html);
  const loaded = bundles(html);
  return Object.entries(BUNDLE_ROOTS).flatMap(([bundle, attr]) => {
    const rooted = new RegExp(`<[a-z][^>]*\\s${attr}[\\s=>]`).test(body);
    if (rooted === loaded.includes(bundle)) return [];
    return [rooted ? `${name} renders [${attr}] without the ${bundle} bundle` : `${name} loads the ${bundle} bundle without [${attr}]`];
  });
}

// A page's HTML without its comments, scripts, and styles.
function markup(html: string): string {
  return html.replace(/<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1>/g, "");
}

// The files that differ between two builds of one site, as paths from
// the site's root.
function differences(a: string, b: string): string[] {
  const files = (dir: string): Set<string> =>
    new Set(readdirSync(dir, { encoding: "utf8", recursive: true }).filter((f) => statSync(join(dir, f)).isFile()));
  const [left, right] = [files(a), files(b)];
  return [...new Set([...left, ...right])].sort()
    .filter((f) => !left.has(f) || !right.has(f) || !readFileSync(join(a, f)).equals(readFileSync(join(b, f))));
}

// The icon images that a built site's pages load, as paths from the
// site's root.
function iconImages(out: string): string[] {
  const srcs = htmlFiles(out).flatMap((file) =>
    [...read(file).matchAll(/<img src="?([^"\s>]*\/unity\/icons\/[^"\s>]+\.svg)/g)].map((m) => m[1]!));
  return [...new Set(srcs)];
}

// An <img> draws an SVG file only when its root <svg> declares the SVG
// namespace.
function isSvgFile(file: string): boolean {
  return existsSync(file) && /^\s*<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(read(file));
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
    const args = (dest: string): string[] => ["--source", source, "--destination", dest,
      "--printPathWarnings", ...(site.warns ? [] : ["--quiet", "--panicOnWarning"]), ...flags];
    const prep = prepare ? hugo([...prepare, "--source", source]) : undefined;
    const run = prep?.ok === false ? prep : hugo(args(out));
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
    if (site.reproducible) {
      const again = join(work, `${name}-again`);
      if (!hugo(args(again)).ok) problems.push("the second build failed");
      else problems.push(...differences(out, again).map((f) => `${f} differs between two builds`));
    }
    for (const p of problems) console.error(`     ${name}: ${p}`);
    console.log(`${problems.length ? "FAIL" : "ok  "} ${name}`);
    failed ||= problems.length > 0;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
