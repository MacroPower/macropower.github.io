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
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import { crc32, deflateSync } from "node:zlib";

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
// time and must write the same files byte for byte. A site that gives
// each language its own baseURL lists them in hosts, by the directory
// that Hugo writes the language into, and the link check reads each
// directory as a site of its own.
type SiteSpec = ({ source: string; flags?: string[] } | { files: Record<string, string | Uint8Array>; prepare?: string[] }) & {
  check?: (out: string, source: string) => (string | false)[];
  warns?: RegExp[];
  reproducible?: boolean;
  hosts?: Record<string, string>;
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
      const welcome = read(join(out, "posts/2024/02/welcome-to-the-desktop/index.html"));
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
        // The theme's markup and taxonomies, which the site takes with _merge.
        !welcome.includes('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">')
          && "the welcome post's TeX block does not render as MathML",
        !welcome.includes('<pre tabindex="0" class="chroma">') && "the welcome post's code is not highlighted with classes",
        !sitemap.includes("/series/</loc>") && "sitemap.xml lacks the series taxonomy",
        robotsSitemap(out, "robots.txt", "https://example.org/sitemap.xml"),
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
        // The shortcuts dialog lists the keys of the blog, the projects
        // grid, and the solitaire table.
        ...surfaceFlagProblems(out, true),
        // Each list's search names its own list, the post list's sorted
        // column names its order, and the Spotify player names its type.
        ...([["posts/index.html", ' aria-label="Search posts"'], ["projects/index.html", ' aria-label="Filter projects"'],
          ["posts/index.html", ' aria-label="Date, sorted descending"'],
          ["posts/2024/02/welcome-to-the-desktop/index.html", ' title="Spotify album player"']] as const)
          .filter(([file, text]) => !read(join(out, file)).includes(text))
          .map(([file, text]) => `${file} lacks${text}`),
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
        ...htmlFiles(out).flatMap((file) => nonconforming(relative(out, file), read(file))),
        ...htmlFiles(out).flatMap((file) => duplicateIds(relative(out, file), read(file))),
        ...htmlFiles(out).flatMap((file) => bundleMismatches(relative(out, file), read(file))),
        // The launcher's full-color art loads as images, so it stays out
        // of every page's HTML.
        read(join(out, "about/index.html")).includes("<linearGradient") && "about/index.html inlines gradient art",
        ...iconImages(out).filter((src) => !isSvgFile(join(out, src))).map((src) => `${src} is not a standalone SVG`),
        // The home's social links, which Mastodon and IndieAuth read.
        !home.includes('<link rel="me" href="https://github.com/jane">') && "index.html's head lacks a rel=me GitHub link",
        !home.includes('<a href="https://github.com/jane" rel="me">') && "index.html's GitHub link lacks rel=me",
        // Nothing a Content Security Policy without 'unsafe-inline' blocks.
        ...htmlFiles(out).flatMap((file) => {
          const html = read(file);
          const name = relative(out, file);
          return [
            /<[a-z][^>]*\sstyle="/.test(html) && `${name} has a style attribute`,
            /<style[\s>]/.test(html) && `${name} has a style element`,
            /<[a-z][^>]*\son[a-z]+=/.test(html) && `${name} has an inline event handler`,
            /<script(?![^>]*\ssrc=)(?![^>]*\stype="application\/(?:ld\+)?json")[^>]*>/.test(html) && `${name} has an inline script`,
            // Each aria-labelledby names one element, and each sidebar
            // label names the group its section forms.
            ...[...html.matchAll(/\saria-labelledby="([^"]+)"/g)]
              .flatMap((m) => m[1]!.split(" "))
              .filter((id) => html.split(` id="${id}"`).length !== 2)
              .map((id) => `${name} has no single element with the id ${id}`),
            html.split('class="up-naut-section-label"').length - 1
              !== [...html.matchAll(/<div class="up-naut-section" role="group" aria-labelledby="([\w-]+)"><div id="\1" class="up-naut-section-label">/g)].length
              && `${name} has a sidebar label that names no group`,
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
  // Addresses a site writes in its menu and data, on a site served from
  // a subdirectory. Each resolves under baseURL once, whether or not it
  // already starts with /sub/, and a menu url keeps its case and query.
  urls: {
    files: {
      "hugo.toml": `${config("https://example.org/sub/")}[[menu.main]]
  identifier = "files"
  name = "Files"
  url = "/files/"
[[menu.main]]
  identifier = "notes"
  name = "Notes"
  url = "/sub/notes/"
[[menu.main]]
  identifier = "search"
  name = "Search"
  url = "/Search/?q=Go"
`,
      "content/sponsors.md": page("Sponsors", "layout = 'sponsors'\n"),
      "data/sponsors.yaml": "- name: Ada\n  avatar: /ada.png\n- name: Grace\n  avatar: grace.png\n- name: Hopper\n  avatar: /sub/hopper.png\n",
      "assets/grace.png": "PNG",
      // The files that the menu entries and the avatars link, for the
      // link check.
      "static/files/index.html": "Files\n",
      "static/notes/index.html": "Notes\n",
      "static/Search/index.html": "Search\n",
      "static/ada.png": "PNG",
      "static/hopper.png": "PNG",
    },
    check: (out) => {
      const html = read(join(out, "sponsors/index.html"));
      return [
        'href="/sub/files/" data-launcher="files"',
        'href="/sub/notes/" data-launcher="notes"',
        'href="/sub/Search/?q=Go" data-launcher="search"',
        'src="/sub/ada.png"',
        'src="/sub/grace.png"',
        'src="/sub/hopper.png"',
      ].map((want) => !html.includes(want) && `sponsors/index.html lacks ${want}`);
    },
  },
  // No title, params, or content. Every page still names itself, and the
  // home page takes the host of baseURL. The terminal's window takes the
  // default guest login.
  bare: {
    files: { "hugo.toml": BARE },
    check: (out) => {
      const names = accentNames(out);
      return [
        !read(join(out, "index.html")).includes("<title>example.org</title>") && "index.html is not titled by its host",
        jsonld(read(join(out, "index.html")))["@graph"]?.find((n) => n["@type"] === "WebSite")?.name !== "example.org"
          && "index.html's JSON-LD WebSite is not named by its host",
        !read(join(out, "index.html")).includes('class="up-titlebar-text">user@example.org: ~<')
          && "index.html's titlebar is not the default guest login",
        !read(join(out, "index.html")).includes('data-up-accent="orange"') && "index.html does not start with the orange accent",
        names !== "orange green aubergine blue" && `the Preferences dialog offers ${names}, not the theme's presets`,
        ...studioProblems(out, "index.html", false),
        // The shortcuts dialog leaves out the keys of the pages the site lacks.
        ...surfaceFlagProblems(out, false),
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
enableRobotsTXT = true
[sitemap]
  filename = "map.xml"
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
      // Hugo writes a sitemap index at the root that names each
      // language's sitemap, all under the site's sitemap filename.
      robotsSitemap(out, "robots.txt", "https://example.org/map.xml"),
    ],
  },
  // Each language on its own host. The language menu links across hosts
  // by absolute URL, because a root-relative link stays on the host that
  // serves the page. Now has no German translation, so its German row
  // leads to the German home page. Hugo writes each language into its
  // own directory, and the build fails when it writes a file there twice.
  // German sets a wallpaper, so each language links its own stylesheet.
  // Each host's robots.txt names that host's sitemap.
  multihost: {
    files: {
      "hugo.toml": `${BARE}enableRobotsTXT = true
[languages.en]
  baseURL = "https://example.com/"
  weight = 1
[languages.de]
  baseURL = "https://example.de/"
  weight = 2
  [languages.de.params.desktop]
    wallpaper = "images/wall.png"
`,
      "assets/images/wall.png": "PNG",
      "content/about.md": page("About"),
      "content/about.de.md": page("Über"),
      "content/now.md": page("Now"),
    },
    hosts: { en: "https://example.com/", de: "https://example.de/" },
    check: (out) => {
      const rows: [file: string, lang: string, want: string][] = [
        ["en/about/index.html", "de", "https://example.de/about/"],
        ["de/about/index.html", "en", "https://example.com/about/"],
        ["en/now/index.html", "de", "https://example.de/"],
      ];
      return rows.map(([file, lang, want]) => {
        const got = new RegExp(`up-lang-row[^"]*" href="([^"]*)" hreflang="${lang}"`).exec(read(join(out, file)))?.[1];
        return got !== want && `${file}'s ${lang} row links ${got}, not ${want}`;
      }).concat([
        robotsSitemap(out, "en/robots.txt", "https://example.com/sitemap.xml"),
        robotsSitemap(out, "de/robots.txt", "https://example.de/sitemap.xml"),
      ]);
    },
  },
  // A second language with its own highlight style, accent preset, and
  // wallpaper. Its pages link a stylesheet of their own, and the first
  // language's stylesheet keeps the defaults. Both stylesheets name the
  // same fonts, which the build fails to publish twice.
  langstyle: {
    files: {
      "hugo.toml": `${BARE}[languages.en]
  weight = 1
[languages.de]
  weight = 2
  [languages.de.markup.highlight]
    style = "github"
  [languages.de.params.desktop]
    accent = "teal"
    wallpaper = "images/wall.png"
  [languages.de.params.desktop.accents.teal]
    color = "#00897B"
`,
      "assets/images/wall.png": "PNG",
      "content/about.md": page("About"),
      "content/about.de.md": page("Über"),
    },
    check: (out) => {
      const sheet = (file: string): string => {
        const href = /<link rel="stylesheet" href="\/([^"]+)"/.exec(read(join(out, file)))?.[1];
        return href ? read(join(out, href)) : "";
      };
      const [en, de] = [sheet("about/index.html"), sheet("de/about/index.html")];
      // The highlight style's background, in the unity.chroma layer.
      const background = (css: string): string | undefined => {
        const m = /(?<=[{}])\.bg\s*\{([^}]*)\}/.exec(css);
        return m && layerAt(css, m.index) === "unity.chroma" ? flat(m[1]!) : undefined;
      };
      const teal = (css: string): boolean => /:root\[data-up-accent="?teal"?\]/.test(css);
      // The --up-wallpaper values in the unity.theme layer, main.css's
      // default first.
      const walls = (css: string): string[] => [...css.matchAll(/--up-wallpaper:\s*([^;}]+)/g)]
        .filter((m) => layerAt(css, m.index) === "unity.theme").map((m) => m[1]!.trim());
      const image = /^url\("?\/([^")]+)"?\) center\/cover no-repeat$/.exec(walls(de)[1] ?? "")?.[1];
      return [
        en === de && "de/about/index.html links the English stylesheet",
        sheet("index.html") !== en && "index.html and about/index.html link different stylesheets",
        !background(en)?.includes("background-color:#272822") && "the English stylesheet lacks monokai's background",
        !background(de)?.includes("background-color:#f7f7f7") && "the German stylesheet lacks github's background",
        !read(join(out, "index.html")).includes('data-up-accent="orange"') && "index.html does not start with the orange accent",
        !read(join(out, "de/index.html")).includes('data-up-accent="teal"') && "de/index.html does not start with the teal accent",
        teal(en) && "the English stylesheet has the German teal preset",
        !teal(de) && "the German stylesheet lacks the teal preset",
        walls(en).length !== 1 && "the English stylesheet sets a wallpaper beside main.css's default",
        !(walls(de).length === 2 && image && existsSync(join(out, image)))
          && "the German stylesheet lacks the wallpaper rule after main.css's default, with its image published",
      ];
    },
  },
  // A second language that turns the font preloads off. The first keeps
  // the theme's preloads: the regular Ubuntu face on every page, and
  // Ubuntu Mono beside it on the home terminal.
  preload: {
    files: {
      "hugo.toml": `${BARE}[languages.en]
  weight = 1
[languages.de]
  weight = 2
  [languages.de.params.desktop]
    fontPreload = false
`,
      "content/about.md": page("About"),
      "content/about.de.md": page("Über"),
    },
    check: (out) => {
      const faces = (file: string): string =>
        [...read(join(out, file)).matchAll(/<link rel="preload" as="font"[^>]* href="[^"]*\/([a-z0-9-]+)-[A-Z0-9]+\.woff2"/g)]
          .map((m) => m[1]).sort().join(" ") || "nothing";
      return [
        faces("index.html") !== "ubuntu-400-latin ubuntu-mono-400-latin"
          && `index.html preloads ${faces("index.html")}, not Ubuntu and Ubuntu Mono`,
        faces("about/index.html") !== "ubuntu-400-latin" && `about/index.html preloads ${faces("about/index.html")}, not Ubuntu`,
        ...["de/index.html", "de/about/index.html"]
          .filter((file) => read(join(out, file)).includes('rel="preload"'))
          .map((file) => `${file} preloads a font with fontPreload off`),
      ];
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
  // A blog without a title or params.description whose older post was
  // edited last, and a Markdown copyright. RSS requires a channel
  // description, which names the site by its host, the lastBuildDate must
  // follow the latest edit rather than the latest post, and the feed's
  // copyright must be plain text.
  feed: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]
copyright = "[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) & Jane"
`,
      "content/posts/old.md": page("Old", "date = 2024-01-01\nlastmod = 2024-06-01\n"),
      "content/posts/new.md": page("New", "date = 2024-03-01\n"),
    },
    check: (out) => {
      const channel = read(join(out, "index.xml")).split("<item>")[0]!;
      return [
        !channel.includes("<description>Recent posts on example.org</description>")
          && "index.xml's channel description does not name the untitled site by its host",
        !channel.includes("<lastBuildDate>Sat, 01 Jun 2024 ") && "index.xml's lastBuildDate ignores the latest lastmod",
        !channel.includes("<copyright>CC BY 4.0 &amp; Jane</copyright>") && "index.xml's copyright is not plain text",
        !read(join(out, "posts/new/index.html")).includes(
          '<div class="up-reader-license"><a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> &amp; Jane</div>',
        ) && "posts/new/index.html does not render the copyright's Markdown",
      ];
    },
  },
  // A blog with a post dated in another zone and an undated post. Each
  // post's JSON-LD must link to the WebSite and Person that the home
  // page's graph defines. It must also keep its date's time and zone and
  // omit the dates a post lacks.
  jsonld: {
    files: {
      "hugo.toml": `${BARE}title = "Jane Doe"\nmainSections = ["posts"]\n`,
      "content/posts/dated.md": page("Dated", "date = 2024-01-02T03:04:05-05:00\n"),
      "content/posts/undated.md": page("Undated"),
    },
    check: (out) => {
      const ld = (path: string): LdNode => jsonld(read(join(out, path)));
      const graph = ld("index.html")["@graph"] ?? [];
      const website = graph.find((n) => n["@type"] === "WebSite");
      const owner = graph.find((n) => n["@type"] === "Person")?.["@id"];
      const posts = { dated: ld("posts/dated/index.html"), undated: ld("posts/undated/index.html") };
      return [
        website?.name !== "Jane Doe" && "index.html lacks a WebSite named after the site title",
        (!owner || website?.publisher?.["@id"] !== owner) && "the home's WebSite does not name the home's Person as publisher",
        ...Object.entries(posts).flatMap(([name, post]) => [
          (!website?.["@id"] || post.isPartOf?.["@id"] !== website["@id"]) && `posts/${name}/ is not part of the home's WebSite`,
          (!owner || post.author?.["@id"] !== owner) && `posts/${name}/ has an author other than the home's Person`,
        ]),
        posts.dated.datePublished !== "2024-01-02T03:04:05-05:00" && "posts/dated/ drops its date's time or zone",
        ("datePublished" in posts.undated || "dateModified" in posts.undated) && "posts/undated/ carries a date it lacks",
      ];
    },
  },
  // Share images: a bundle's feature image wider than the 1200 pixels
  // that the theme shares, a narrower one that front matter names with a
  // query, a remote one, and the site's default. Each image Hugo can read
  // must declare its size right after its og:image, and each alt text
  // must describe only its own image.
  share: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]
[params]
  images = ["img/card.png"]
  imageAlt = "A card for the whole site"
`,
      "assets/img/card.png": png(1200, 630),
      "content/posts/wide/index.md": page("Wide", "imageAlt = 'A grey banner'\n"),
      "content/posts/wide/feature.png": png(2400, 1200),
      "content/posts/narrow/index.md": page("Narrow", "images = ['card.png?v=2']\n"),
      "content/posts/narrow/card.png": png(600, 315),
      "content/posts/remote.md": page("Remote", "images = ['https://cdn.example.org/card.png']\n"),
      "content/about.md": page("About", "imageAlt = 'A picture the page lacks'\n"),
    },
    check: (out) => {
      const html = (name: string): string => read(join(out, name, "index.html"));
      const shares = (name: string, want: ShareImage[]): boolean => isDeepStrictEqual(shareImages(html(name)), want);
      const wide = html("posts/wide");
      const copy = shareImages(wide)[0];
      const copyPath = copy?.url.replace("https://example.org/", "") ?? "";
      return [
        (!/^posts\/wide\/feature_.*\.png$/.test(copyPath) || !existsSync(join(out, copyPath)))
          && "posts/wide/ does not share a published copy of its feature image",
        !isDeepStrictEqual(copy, { url: copy?.url, width: 1200, height: 600, alt: "A grey banner" })
          && "posts/wide/ does not describe its copy as 1200x600 with its alt text",
        !wide.includes('<meta name="twitter:image:alt" content="A grey banner">') && "posts/wide/ lacks its twitter:image:alt",
        !isDeepStrictEqual(jsonld(wide).image, [copy?.url]) && "posts/wide/'s JSON-LD image is not the shared copy's URL",
        !shares("posts/narrow", [{ url: "https://example.org/posts/narrow/card.png?v=2", width: 600, height: 315 }])
          && "posts/narrow/ does not share its card at its own size and URL",
        !shares("posts/remote", [{ url: "https://cdn.example.org/card.png" }])
          && "posts/remote/ declares a size or alt text for an image Hugo cannot read",
        !shares("about", [{ url: "https://example.org/img/card.png", width: 1200, height: 630, alt: "A card for the whole site" }])
          && "about/ does not share the site's card with its size and the site's alt text",
      ];
    },
  },
  // Post images. WebP shrinks wide.png and small.png, so their srcsets
  // must list WebP copies. It grows flat.png and tiny.png, so theirs must
  // keep the PNG format. Each src must name the original PNG, which is
  // all the feed shows. The Exif orientation of turned.png turns it a
  // quarter, as a phone photo's does. Its width, height, and copies must
  // follow the turned image that browsers show.
  images: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]
[params.blog]
  feedFullContent = true
`,
      "content/posts/shots/index.md":
        "+++\ntitle = 'Shots'\n+++\n![](wide.png) ![](small.png) ![](flat.png) ![](tiny.png) ![](turned.png)\n",
      "content/posts/shots/wide.png": png(2000, 1000, { stored: true }),
      "content/posts/shots/small.png": png(400, 300, { stored: true }),
      "content/posts/shots/flat.png": png(2000, 1000, { fill: "checkered" }),
      "content/posts/shots/tiny.png": png(400, 300, { fill: "checkered" }),
      "content/posts/shots/turned.png": png(2000, 1000, { fill: "checkered", orientation: 6 }),
    },
    check: (out) => {
      const html = read(join(out, "posts/shots/index.html"));
      // Each image's attributes after src, keyed by the original's name.
      const attrs = new Map([...html.matchAll(/<img src="\/posts\/shots\/(\w+)\.png"([^>]*)>/g)].map((m) => [m[1]!, m[2]!]));
      const attr = (name: string, key: string): string => new RegExp(`\\s${key}="([^"]*)"`).exec(attrs.get(name) ?? "")?.[1] ?? "";
      const urls = [...attrs.keys()].flatMap((name) => attr(name, "srcset").split(", ").filter(Boolean).map((c) => c.split(" ")[0]!));
      const want: Record<string, [srcset: string, sizes: boolean]> = {
        wide: ["wide_hu.webp 800w, wide_hu.webp 1600w, wide_hu.webp 2000w", true],
        small: ["small_hu.webp", false],
        flat: ["flat_hu.png 800w, flat_hu.png 1600w, flat.png 2000w", true],
        tiny: ["", false],
        turned: ["turned_hu.png 800w, turned.png 1000w", true],
      };
      // A PNG's width and height, from its IHDR chunk.
      const size = (url: string): number[] => {
        const head = readFileSync(join(out, url));
        return [head.readUInt32BE(16), head.readUInt32BE(20)];
      };
      const turnedCopy = attr("turned", "srcset").split(" ")[0] ?? "";
      const feed = read(join(out, "index.xml"));
      return [
        ...Object.entries(want).flatMap(([name, [srcset, sizes]]) => [
          !attrs.has(name) && `posts/shots/ has no img whose src is the original ${name}.png`,
          attr(name, "srcset").replaceAll("/posts/shots/", "").replace(/_hu_\w+\./g, "_hu.") !== srcset
            && `${name}.png's srcset is not "${srcset}"`,
          (attr(name, "sizes") !== "") !== sizes && `${name}.png ${sizes ? "lacks" : "has"} a sizes attribute`,
        ]),
        ...urls.map((url) => {
          const file = join(out, url);
          if (!existsSync(file)) return `posts/shots/ lists ${url}, which the site does not publish`;
          const head = readFileSync(file).subarray(0, 12).toString("latin1");
          return url.endsWith(".webp") && !/^RIFF.{4}WEBP$/s.test(head) && `${url} is not a WebP file`;
        }),
        (attr("turned", "width") !== "1000" || attr("turned", "height") !== "2000")
          && "turned.png's width and height do not follow its orientation",
        (!turnedCopy || !existsSync(join(out, turnedCopy)) || !isDeepStrictEqual(size(turnedCopy), [800, 1600]))
          && "turned.png's 800w copy is not a published 800x1600 image",
        !feed.includes("src=&#34;https://example.org/posts/shots/wide.png&#34;") && "index.xml does not show the original wide.png",
        /srcset|\.webp/.test(feed) && "index.xml lists the WebP copies",
      ];
    },
  },
  // YouTube players on a site that sets privacy.youtube.privacyEnhanced.
  // The theme's youtube shortcode replaces Hugo's, which sizes each player
  // with style attributes. It must keep Hugo's arguments and host, and a
  // class argument must replace the theme's up-embed class.
  youtube: {
    files: {
      "hugo.toml": `${BARE}[privacy.youtube]\n  privacyEnhanced = true\n`,
      "content/video.md": `${page("Video")}
{{< youtube 0RKpf3rK57I >}}

{{< youtube id="0RKpf3rK57I" class="clip" autoplay=true loop=true allowFullScreen=false title="Clip" >}}
`,
    },
    check: (out) => {
      const html = read(join(out, "video/index.html"));
      const src = "https://www.youtube-nocookie.com/embed/0RKpf3rK57I";
      return [
        /<[a-z][^>]*\sstyle="/.test(html) && "video/index.html has a style attribute",
        !/<div class="up-embed">\s*<iframe allow="[^"]*; fullscreen"/.test(html)
          && "video/index.html's default player lacks the up-embed box or full screen",
        !html.includes(`src="${src}?autoplay=0&amp;controls=1&amp;end=0&amp;loop=0&amp;mute=0&amp;start=0" title="YouTube video">`)
          && "video/index.html's default player ignores privacyEnhanced or the default title",
        !/<div class="clip">\s*<iframe allow="[^"]*web-share" loading="eager"/.test(html)
          && "video/index.html's player ignores its class or allowFullScreen",
        !html.includes(`src="${src}?autoplay=1&amp;controls=1&amp;end=0&amp;loop=1&amp;mute=1&amp;playlist=0RKpf3rK57I&amp;start=0" title="Clip">`)
          && "video/index.html's player ignores its autoplay, loop, or title",
      ];
    },
  },
  // Posts in a nested section.
  nested: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]\n`,
      "content/posts/_index.md": page("Posts"),
      "content/posts/old.md": page("Old post", "date = 2023-01-01\n"),
      "content/posts/top.md": page("Top post", "date = 2025-01-01\n"),
      "content/posts/2024/_index.md": page("2024"),
      "content/posts/2024/deep.md": page("Deep post", "date = 2024-01-01\n"),
    },
    check: (out) => {
      const list = read(join(out, "posts/index.html"));
      const deep = read(join(out, "posts/2024/deep/index.html"));
      // Each post's older and newer pathbar arrows, by date across the
      // nested section, with # for a disabled arrow.
      const arrows: Record<string, string> = {
        "posts/old/index.html": "# /posts/2024/deep/",
        "posts/2024/deep/index.html": "/posts/old/ /posts/top/",
        "posts/top/index.html": "/posts/2024/deep/ #",
      };
      return [
        !list.includes("Deep post") && "posts/index.html omits the nested post",
        !deep.includes('class="up-pathbar-btn" href="/posts/"') && "the nested post's pathbar omits the blog section",
        ...Object.entries(arrows).map(([file, want]) => {
          const got = [...read(join(out, file)).matchAll(/class="up-pathbar-arrow[^"]*"\s+href="([^"]*)"/g)]
            .map((m) => m[1]).join(" ");
          return got !== want && `${file}'s pathbar arrows go to "${got}", not "${want}"`;
        }),
      ];
    },
  },
  // A blog that sets params.blog.taxonomies.category to tags and has no
  // categories taxonomy. The tags take the place of the categories in the
  // Places lenses and the post chips.
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
        !list.includes('<span dir="auto" class="up-post-chip">#Home Lab</span>') && "posts/index.html lacks the post's tag chip",
        !read(join(out, "tags/home-lab/index.html")).includes('href="/posts/one/"')
          && "tags/home-lab/index.html does not list the tagged post",
      ];
    },
  },
  // A blog without taxonomy pages, feeds, or a sitemap. The link check
  // fails on any lens, feed, or sitemap link that names a missing page,
  // and robots.txt must not name a sitemap.
  trimmed: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]
enableRobotsTXT = true
disableKinds = ["taxonomy", "term", "rss", "sitemap"]
[taxonomies]
  category = "categories"
  series = "series"
`,
      "content/posts/one.md": page("One", "categories = ['meta']\nseries = ['intro']\n"),
    },
    check: (out) => [robotsSitemap(out, "robots.txt", "")],
  },
  // Posts that carry only tags, under Hugo's default taxonomies and no
  // params. The blog's Places lenses and chips must show the tags.
  tagged: {
    files: {
      "hugo.toml": `${BARE}mainSections = ["posts"]\n`,
      "content/posts/one.md": page("One", "tags = ['intro', 'meta']\n"),
    },
    check: (out) => [
      !read(join(out, "posts/index.html")).includes('href="/tags/intro/"')
        && "posts/index.html does not link the intro tag",
      !read(join(out, "posts/one/index.html")).includes('class="up-reader-chip">#intro<')
        && "posts/one/index.html lacks the #intro chip",
    ],
  },
  // Tag pages and an empty taxonomy in English and in a German
  // translation that puts the tag first. Each sentence comes whole from
  // the translation, and a taxonomy's title keeps its case.
  terms: {
    files: {
      "hugo.toml": `${BARE}[languages.en]\n  weight = 1\n[languages.de]\n  weight = 2\n`,
      "i18n/de.toml": `[posts_tagged]
one = "{{ .Tag }}: {{ .Count }} Beitrag"
other = "{{ .Tag }}: {{ .Count }} Beiträge"
[no_terms_yet]
other = "{{ .Plural }}: noch keine."
`,
      "content/one.md": page("One", "tags = ['intro', 'R&D']\n"),
      "content/two.md": page("Two", "tags = ['intro']\n"),
      "content/one.de.md": page("Eins", "tags = ['intro']\n"),
      "content/categories/_index.de.md": page("Kategorien"),
    },
    check: (out) => {
      const want: [file: string, text: string][] = [
        ["tags/intro/index.html", '<p>2 posts tagged <span dir="auto" class="up-reader-chip">#intro</span>.</p>'],
        ["tags/rd/index.html", '<p>1 post tagged <span dir="auto" class="up-reader-chip">#r&amp;d</span>.</p>'],
        ["de/tags/intro/index.html", '<p><span dir="auto" class="up-reader-chip">#intro</span>: 1 Beitrag</p>'],
        ["categories/index.html", ">Categories: none yet.<"],
        ["de/categories/index.html", ">Kategorien: noch keine.<"],
      ];
      return want.map(([file, text]) => !read(join(out, file)).includes(text) && `${file} lacks ${text}`);
    },
  },
  // Sentences that hold markup, such as the cv page's page number box,
  // in English and in a Japanese translation that moves the markup.
  // Each sentence comes whole from the translation, and each piece of
  // markup lands where the translation puts its placeholder.
  sentences: {
    files: {
      "hugo.toml": `${BARE}[languages.en]\n  weight = 1\n[languages.ja]\n  weight = 2\n`,
      "i18n/ja.toml": `[page_of_total]
other = "全 {{ .Total }} ページ中 {{ .Page }} ページ目"
[sound_output]
other = "出力：{{ .Device }}"
[built_in_audio]
other = "内蔵オーディオ"
[terminal_needs_js]
other = "{{ .Login }}：このターミナルには JavaScript が必要です。"
`,
      "content/cv.md": page("CV", "layout = 'cv'\npdf = '/cv.pdf'\n"),
      "content/cv.ja.md": page("履歴書", "layout = 'cv'\npdf = '/cv.pdf'\n"),
      "static/cv.pdf": "%PDF-1.4\n",
    },
    check: (out) => {
      const box = "<input [^>]*data-docv-pagenum[^>]*>";
      const count = "<span data-docv-pagecount>…</span>";
      const want: [file: string, pattern: RegExp][] = [
        ["cv/index.html", new RegExp(`<div class="up-docv-pageentry">${box} of ${count}</div>`)],
        ["ja/cv/index.html", new RegExp(`<div class="up-docv-pageentry">全 ${count} ページ中 ${box} ページ目</div>`)],
        ["index.html", /<div class="up-dropdown-meta">Output: <span class="up-dropdown-meta-strong">Built-in audio<\/span><\/div>/],
        ["ja/index.html", /<div class="up-dropdown-meta">出力：<span class="up-dropdown-meta-strong">内蔵オーディオ<\/span><\/div>/],
        ["index.html", /<div class="up-shell-noscript"><bdi dir="ltr">user@example\.org<\/bdi>: this terminal requires JavaScript\.<\/div>/],
        ["ja/index.html", /<div class="up-shell-noscript"><bdi dir="ltr">user@example\.org<\/bdi>：このターミナルには JavaScript が必要です。<\/div>/],
      ];
      return want.map(([file, pattern]) =>
        !pattern.test(read(join(out, file)).replace(/\s+/g, " ")) && `${file} does not match ${pattern}`);
    },
  },
  // A non-English default language whose translation covers two keys.
  // The build must say so, and the other strings, in templates and
  // scripts alike, must fall back to English.
  translated: {
    files: {
      "hugo.toml": `${BARE}defaultContentLanguage = "de"\n`,
      "i18n/de.toml": '[home]\nother = "Startseite"\n[page_not_found]\nother = "Seite nicht gefunden"\n',
    },
    warns: [/the "de" translation lacks \d+ of the theme's i18n keys/],
    check: (out) => {
      const js = readdirSync(join(out, "js")).find((f) => f.startsWith("runtime."));
      const home = read(join(out, "index.html"));
      return [
        !home.includes("Startseite") && "index.html drops the translated home label",
        !read(join(out, "404.html")).includes("<title>Seite nicht gefunden</title>") && "404.html keeps Hugo's English title",
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
[params.author]
  born = "Jan 1990"
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
[[menu.main]]
  identifier = "ghost"
  name = "Ghost"
  pageRef = "/ghost"
`,
      "data/projects.yaml": "- name: named-project\n  updated: last week\n- description: nameless-project\n",
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
      /params\.author\.born "Jan 1990" is not a date/,
      /the data\/projects entry "named-project" sets updated to "last week"/,
      /the menu\.main entry "Ghost" points at no page in "en"/,
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
        home.includes('data-launcher="ghost"') && "index.html docks the menu entry whose pageRef finds no page",
        home.includes("jane") && "index.html renders the malformed params.social",
        home.includes("Jan 1990") && "index.html renders the malformed params.author.born",
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
  // properties and [dir="rtl"] rules follow. Shell lines and the home
  // terminal stay left to right, and the terminal stays English. Each
  // name the desktop shows takes the direction of its first letter, so a
  // Latin title keeps its punctuation at its end. The projects page lays
  // out a mirrored grid of tiles.
  rtl: {
    files: {
      "hugo.toml": `${BARE}defaultContentLanguage = "ar"
mainSections = ["posts"]
ignoreLogs = ["unity-i18n-missing"]
[languages.ar]
  direction = "rtl"
`,
      "content/posts/one.md": page("Hello, world!", "tags = ['a']\n"),
      "content/projects.md": page("Projects", "layout = 'projects'\n"),
      "data/projects.yaml": "- {name: alpha, language: Go}\n- {name: beta, language: Rust}\n",
    },
    check: (out) => {
      const dash = readdirSync(join(out, "dash")).map((f) => read(join(out, "dash", f))).join("");
      const want: [file: string, text: string][] = [
        ["index.html", '<div lang="en" dir="ltr" class="up-shell-term" data-shell-mount>'],
        ["index.html", '<span dir="auto" class="up-titlebar-text">user@example.org: ~</span>'],
        ["index.html", '<bdi dir="ltr">/personal-site</bdi>'],
        ["posts/index.html", '<div dir="auto" class="up-post-title">Hello, world!</div>'],
        ["posts/index.html", '<span dir="auto" class="up-post-chip">#a</span>'],
        ["posts/index.html", '<span dir="auto" class="up-pathbar-label">Posts</span>'],
        ["posts/index.html", '<span dir="auto" class="up-naut-item-label">A</span>'],
        ["posts/index.html", '<div dir="ltr" class="up-empty-pane-tagline"'],
        ["posts/one/index.html", '<span dir="auto" class="up-reader-chip">#a</span>'],
        ["posts/one/index.html", '— <bdi dir="ltr">user@unity:~/posts$</bdi>'],
        ["projects/index.html", '<span dir="auto" class="up-project-tile-label">alpha</span>'],
        ["tags/a/index.html", '— <bdi dir="ltr">user@unity:~$ grep -l "a" posts/*.md</bdi>'],
        ["404.html", '<div lang="en" dir="ltr" class="up-empty-pane-tagline"'],
      ];
      return [
        ...["index.html", "posts/index.html", "posts/one/index.html"]
          .filter((p) => !/<html [^>]*\bdir="rtl"/.test(read(join(out, p))))
          .map((p) => `${p} lacks dir="rtl" on <html>`),
        ...want.map(([file, text]) => !read(join(out, file)).includes(text) && `${file} lacks ${text}`),
        !dash.includes("<span dir=auto class=up-dash-tile-label>Hello, world!<") && "the Dash's post tile lacks dir=auto",
      ];
    },
  },
  // Pages and a section without a title. A post takes its date, and any
  // other page or section its file name.
  untitled: {
    files: {
      "hugo.toml": `${BARE}title = "Notebook"\nmainSections = ["posts"]\n`,
      "content/posts/_index.md": "+++\n+++\n",
      "content/posts/note.md": "+++\ndate = 2024-03-05\n+++\nA note.\n",
      "content/loose-leaf.md": "+++\ndate = 2024-01-01\n+++\nA page.\n",
    },
    check: (out) => [
      !read(join(out, "posts/note/index.html")).includes('<h1 class="up-reader-title">Mar 5, 2024</h1>')
        && "posts/note/index.html is not titled by its date",
      !read(join(out, "posts/index.html")).includes('<div dir="auto" class="up-post-title">Mar 5, 2024</div>')
        && "posts/index.html lists the post without its date",
      !read(join(out, "index.xml")).includes("<title>Mar 5, 2024</title>") && "index.xml lists the post without its date",
      !read(join(out, "loose-leaf/index.html")).includes("<title>Loose Leaf | Notebook</title>")
        && "loose-leaf/index.html is not titled by its file name",
      !read(join(out, "posts/index.html")).includes("<title>Posts | Notebook</title>")
        && "posts/index.html is not titled by its directory name",
    ],
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
  // Menu entries whose pageRef finds no page: Blog in both languages,
  // because the site has no posts yet, and About in German. Each one
  // drops out of that language's desktop with a warning, so no tile
  // links to the home page and claims every page as current.
  unresolved: {
    files: {
      "hugo.toml": `${BARE}[languages.en]
  weight = 1
[languages.de]
  weight = 2
[[menu.main]]
  identifier = "blog"
  name = "Blog"
  pageRef = "/posts"
[[menu.main]]
  identifier = "about"
  name = "About"
  pageRef = "/about"
`,
      "content/about.md": page("About"),
    },
    warns: [
      /unity: the menu\.main entry "Blog" points at no page in "en"/,
      /unity: the menu\.main entry "Blog" points at no page in "de"/,
      /unity: the menu\.main entry "About" points at no page in "de"/,
    ],
    check: (out) => {
      const active = (file: string): string =>
        [...read(join(out, file)).matchAll(/class="up-launcher-tile is-active"[^>]*data-launcher="([^"]*)"/g)]
          .map((m) => m[1]).join(" ");
      // UP_SITE.nav in the language's runtime script.
      const nav = (lang: string): string => {
        const file = readdirSync(join(out, "js")).find((f) => f.startsWith(`runtime.${lang}.`));
        return (file && read(join(out, "js", file)).match(/nav:\{[^}]*\}/)?.[0]) || "";
      };
      return [
        active("about/index.html") !== "about"
          && `about/index.html marks "${active("about/index.html")}" current, not "about"`,
        active("de/index.html") !== "home" && `de/index.html marks "${active("de/index.html")}" current, not "home"`,
        !nav("en").includes('about:"/about/"') && `the English nav lacks About: ${nav("en")}`,
        /\bblog:/.test(nav("en")) && `the English nav maps Blog: ${nav("en")}`,
        /\b(?:blog|about):/.test(nav("de")) && `the German nav maps Blog or About: ${nav("de")}`,
      ];
    },
  },
  // A home page in a plain window instead of the terminal. The Dash and
  // the shortcuts dialog drop the terminal with it. Its head must still
  // link the social profiles with rel=me.
  homepage: {
    files: {
      "hugo.toml": `${BARE}[params.home]
  layout = "page"
[[params.social]]
  name = "mastodon"
  url = "https://mastodon.example/@jane"
`,
      "content/_index.md": page("Welcome"),
    },
    check: (out) => {
      const home = read(join(out, "index.html"));
      const tile = homeTile(home);
      return [
        !home.includes("Body of Welcome.") && "index.html omits the home's content",
        home.includes("data-shell") && "index.html still renders the terminal",
        home.includes("/js/shell.") && "index.html still loads the shell bundle",
        !tile.includes('class="up-dash-tile-label">Home<') && "the Dash does not label the home page Home",
        tile.includes("shell") && "the home page's Dash tile carries shell keywords",
        !/terminal:(?:!1|false)\b/.test(runtime(out, "en")) && "UP_SITE does not say the site lacks the terminal",
        !home.includes('<link rel="me" href="https://mastodon.example/@jane">') && "index.html lacks a rel=me Mastodon link",
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
      "content/glyphs.md": page("Glyphs", "layout = 'catalogue'\n"),
      "content/posts/one.md": page("One"),
      "content/posts/note.md": page("Note", "layout = 'plain'\n"),
      "layouts/portfolio.html": '{{ define "main" }}{{ partial "unity/page/projects.html" . }}{{ end }}\n',
      "layouts/resume.html": '{{ define "main" }}{{ partial "unity/page/cv.html" . }}{{ end }}\n',
      "layouts/cards.html": '{{ define "main" }}{{ partial "unity/page/solitaire.html" . }}{{ end }}\n',
      "layouts/catalogue.html": '{{ define "main" }}{{ partial "unity/page/icons.html" . }}{{ end }}\n',
      "layouts/plain.html": '{{ define "main" }}{{ .Content }}{{ end }}\n',
    },
    check: (out) => [
      ...Object.entries({ "work/index.html": "projects", "resume/index.html": "cv", "game/index.html": "solitaire",
        "glyphs/index.html": "icons" })
        .filter(([file, bundle]) => !bundles(read(join(out, file))).includes(bundle))
        .map(([file, bundle]) => `${file} does not load the ${bundle} bundle`),
      ...htmlFiles(out).flatMap((file) => bundleMismatches(relative(out, file), read(file))),
    ],
  },
  // A home terminal with its own guest login and a site title. The
  // login titles the terminal's window, and the share title stays the
  // site's. The title in the German home's front matter replaces the
  // login, so only the English prompt retitles its window after a cd.
  terminal: {
    files: {
      "hugo.toml": `${BARE}title = "Jane Doe"
[languages.en]
  weight = 1
[languages.de]
  weight = 2
[params.terminal]
  user = "guest"
  host = "box"
`,
      "content/_index.de.md": page("Lobby"),
    },
    check: (out) => {
      const home = read(join(out, "index.html"));
      return [
        !home.includes('class="up-titlebar-text">guest@box: ~<') && "index.html's titlebar is not the guest login",
        !/data-panel-slot="title">\s*guest@box: ~\s*</.test(home) && "index.html's panel title is not the guest login",
        !home.includes('og:title" content="Jane Doe"') && "index.html's share title is not the site's title",
        !read(join(out, "de/index.html")).includes('class="up-titlebar-text">Lobby<')
          && "de/index.html's titlebar ignores the home's title",
        cwdTitle(home) !== true && "index.html's prompt does not retitle its window",
        cwdTitle(read(join(out, "de/index.html"))) !== false && "de/index.html's prompt replaces the home's title",
        !homeTile(home).includes('class="up-dash-tile-label">Terminal<') && "the Dash does not label the home terminal Terminal",
        !/terminal:(?:!0|true)\b/.test(runtime(out, "en")) && "UP_SITE does not say the site has the terminal",
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
        ...studioProblems(out, "index.html", true),
      ];
    },
  },
  // A Studio playlist that only one language sets.
  studiolang: {
    files: {
      "hugo.toml": `${BARE}defaultContentLanguage = "en"
[languages.en]
  weight = 1
[languages.de]
  weight = 2
  [languages.de.params.studio]
    playlist = ["music/a.mid"]
`,
      "assets/music/a.mid": "MThd",
    },
    check: (out) => [...studioProblems(out, "index.html", false), ...studioProblems(out, "de/index.html", true)],
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
        !teal?.includes(flat("--up-accent-lighter:color-mix(in srgb, #00897B 40%, white)"))
          && "the stylesheet lacks the teal preset's rule with a mixed lighter shade",
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
  // A birth date and a project date that Hugo cannot parse. Each warns
  // with the param or entry that holds it and drops out. The banner's
  // uptime then counts from the oldest page, and the vague project shows
  // no date. A date in another form that Hugo parses becomes YYYY-MM-DD,
  // and the Recent filter compares it with the cutoff.
  dates: {
    files: {
      "hugo.toml": `${BARE}[params.author]
  born = "Jan 1990"
[params.projects]
  recentMonths = 1200
`,
      "content/projects.md": page("Projects", "date = 2001-02-03\nlayout = 'projects'\n"),
      "data/projects.yaml": "- name: stamped\n  updated: 2024-05-20T10:00:00Z\n- name: ancient\n  updated: 1901-01-01\n"
        + "- name: vague\n  updated: last week\n",
    },
    warns: [/params\.author\.born "Jan 1990" is not a date/, /"vague" sets updated to "last week"/],
    check: (out) => {
      const html = read(join(out, "projects/index.html"));
      const tile = (name: string): string => new RegExp(`<button[^>]*data-name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
      const recent = (name: string): boolean => /data-filters="[^"]*\brecent\b/.test(tile(name));
      return [
        !tile("stamped").includes('data-updated="2024-05-20"') && "the stamped project's date is not 2024-05-20",
        !recent("stamped") && "the stamped project is not recent",
        recent("ancient") && "the ancient project is recent",
        !tile("vague").includes('data-updated=""') && "the vague project keeps a date",
        recent("vague") && "the vague project is recent",
        !read(join(out, "index.html")).includes('"since":"2001-02-03"')
          && "the banner's uptime does not count from the oldest page",
      ];
    },
  },
  // The curation params narrow the projects without regard to case, and
  // a single string stands for a list of one. A string exclude matches
  // whole names only, so "hid" stays.
  curated: {
    files: {
      "hugo.toml": `${BARE}[params.projects]
  exclude = "HIDDEN"
  languages = ["go", "RUST"]
  requireDescription = true
`,
      "content/projects.md": page("Projects", "layout = 'projects'\n"),
      "data/projects.yaml": "- {name: kept, language: Go, description: Kept.}\n"
        + "- {name: Tool, language: Rust, description: Kept.}\n"
        + "- {name: hid, language: Go, description: Kept.}\n"
        + "- {name: hidden, language: Go, description: Excluded.}\n"
        + "- {name: snake, language: Python, description: Not an allowed language.}\n"
        + "- {name: blank, language: Go}\n",
    },
    check: (out) => {
      const html = read(join(out, "projects/index.html"));
      const names = [...html.matchAll(/data-up-project-tile\s+data-name="([^"]*)"/g)].map((m) => m[1]).join(" ");
      return [names !== "kept Tool hid" && `the projects page lists "${names}", not "kept Tool hid"`];
    },
  },
  // Projects from a GitHub account, with the request denied so the build
  // never touches the network. The build warns and the page renders
  // without projects. Hugo checks the request's options, such as its
  // timeout, before the URL, so a bad option warns with another message.
  github: {
    files: {
      "hugo.toml": `${BARE}[params.projects]
  github = "jane"
[security.http]
  urls = ['^https://example\\.invalid/']
`,
      "content/projects.md": page("Projects", "layout = 'projects'\n"),
    },
    warns: [/cannot fetch the GitHub repositories for params\.projects\.github: .*access denied: "https:\/\/api\.github\.com\//],
    check: (out) => [
      /data-up-project-tile\s+data-name=/.test(read(join(out, "projects/index.html"))) && "the projects page lists projects",
    ],
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

// The fields of window.UP_SITE that the checks read.
interface UpSite {
  accents?: { name: string; label: string }[];
  blog?: unknown;
  projects?: unknown;
  solitaire?: unknown;
}

// The window.UP_SITE that the runtime script index.html loads sets.
function upSite(out: string): UpSite {
  const src = /<script defer src="([^"]+\/runtime\.[^"]+)"/.exec(read(join(out, "index.html")))?.[1];
  const window: { UP_SITE?: UpSite } = {};
  if (src) runInNewContext(read(join(out, src)), { window });
  return window.UP_SITE ?? {};
}

// A failure for each UP_SITE field that tells the shortcuts dialog
// whether the site has the blog, the projects grid, or the solitaire
// table, when the field does not hold want.
function surfaceFlagProblems(out: string, want: boolean): string[] {
  const site = upSite(out);
  return (["blog", "projects", "solitaire"] as const)
    .filter((key) => site[key] !== want)
    .map((key) => `UP_SITE.${key} is ${String(site[key])}, not ${want}`);
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
// item role that states its checked and disabled flags, and it stays out
// of the tab order, so Tab leaves the menu.
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
      attr(tag, "tabindex") !== "-1" && `${label} is in the tab order`,
    ].filter((p) => p !== false);
  });
}

// The elements of a page's markup in document order. Each one comes
// with its attributes as written and the elements still open around
// it, outermost first. The walk skips comments, scripts, and styles,
// and it never opens a void or self-closed tag. An end tag closes
// every element back to its start tag, so it also closes the elements
// inside that a minifier left open. Minified files drop the quotes
// around a plain attribute value.
type Element = { tag: string; attrs: string };
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
function* elements(html: string): Generator<Element & { ancestors: Element[] }> {
  const open: Element[] = [];
  for (const m of markup(html).matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const [, end, rawTag, rawAttrs] = m;
    const tag = rawTag!.toLowerCase();
    const attrs = rawAttrs!;
    if (end) {
      const at = open.findLastIndex((e) => e.tag === tag);
      if (at !== -1) open.length = at;
      continue;
    }
    yield { tag, attrs, ancestors: [...open] };
    if (!VOID.has(tag) && !attrs.endsWith("/")) open.push({ tag, attrs });
  }
}

// Every SVG on a page decorates a control that names itself. Each one
// must sit under aria-hidden="true", on itself or on an ancestor. A named
// image (role="img" with an aria-label) passes too.
function exposedSvgs(name: string, html: string): string[] {
  const hidden = (e: Element): boolean => /\saria-hidden="?true\b/.test(e.attrs);
  return [...elements(html)]
    .filter((e) => e.tag === "svg" && !hidden(e) && !e.ancestors.some(hidden)
      && !(/\srole="?img\b/.test(e.attrs) && /\saria-label="?[^"\s>]/.test(e.attrs)))
    .map((e) => `${name} exposes an unnamed <svg${e.attrs.slice(0, 60)}>`);
}

// Markup that the Nu HTML checker rejects. HTML allows a <main> only
// inside <html>, <body>, <div>, and <form> elements and custom
// elements. An iframe's width and height take a whole number of pixels.
function nonconforming(name: string, html: string): string[] {
  return [...elements(html)].flatMap((e): string[] => {
    if (e.tag === "main") {
      return e.ancestors
        .filter((a) => !["html", "body", "div", "form"].includes(a.tag) && !a.tag.includes("-"))
        .map((a) => `${name} renders its <main> inside a <${a.tag}>`);
    }
    if (e.tag !== "iframe") return [];
    return [...e.attrs.matchAll(/\s(width|height)=(?:"([^"]*)"|([^\s"']*))/g)]
      .filter((m) => !/^[0-9]+$/.test(m[2] ?? m[3]!))
      .map((m) => `${name} gives an <iframe> the ${m[1]} "${m[2] ?? m[3]}"`);
  });
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

// A page loads the app bundle with the Studio's code exactly when its
// language has a playlist. The Studio window's data-daw hooks and the
// synth's AudioContext mark that code. So do the Studio's label keys and
// the velSens param. esbuild keeps them in the bundle without the Studio
// when a top-level call or object spread in audio.ts or daw.ts reads them.
function studioProblems(out: string, file: string, studio: boolean): string[] {
  const src = /<script[^>]*\ssrc="?([^"\s>]*\/js\/app[-.][^"\s>]*)/.exec(read(join(out, file)))?.[1];
  if (!src) return [`${file} loads no app bundle`];
  const js = read(join(out, src));
  return ["data-daw", "AudioContext", "js_studio_", "js_sound_", "velSens"]
    .filter((marker) => js.includes(marker) !== studio)
    .map((marker) => `${file} loads ${src}, which ${studio ? "lacks" : "carries"} the Studio's ${marker}`);
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

// The minified runtime script for a language, which sets window.UP_SITE.
function runtime(out: string, lang: string): string {
  const file = readdirSync(join(out, "js")).find((f) => f.startsWith(`runtime.${lang}.`));
  return file ? read(join(out, "js", file)) : "";
}

// The home page's tile in the Dash's Applications category.
function homeTile(html: string): string {
  return /<a class="up-dash-tile" data-dash-tile href="\/"[\s\S]*?<\/a>/.exec(html)?.[0] ?? "";
}

// The cwdTitle flag in the home terminal's data island, which says
// whether the prompt retitles the window, or undefined without an island.
function cwdTitle(html: string): unknown {
  const island = /data-shell-data>([^<]*)<\/script>/.exec(html)?.[1];
  return island === undefined ? undefined : (JSON.parse(island) as { cwdTitle?: unknown }).cwdTitle;
}

// Returns a problem unless the robots.txt at file, under out, names the
// sitemap at want. An empty want means the file must not name one.
function robotsSitemap(out: string, file: string, want: string): string | false {
  const got = [...read(join(out, file)).matchAll(/^Sitemap: (.*)$/gm)].map((m) => m[1]).join(" ");
  return got !== want && `${file} names the sitemap "${got}", not "${want}"`;
}

// Each pattern matches a place that names a page but holds no text.
// Every page and feed of every site must match none of them. The Dash
// fragment is minified, so the attribute quotes are optional.
const BLANK_TITLES: [string, RegExp][] = [
  ["an empty <title>", /<title>\s*(?:\|[^<]*)?<\/title>|\s\|\s*<\/title>/],
  ["an empty <h1>", /<h1[^>]*>\s*<\/h1>/],
  ["an empty share title", /(?:og|twitter):title" content=""/],
  ["an empty panel title", /data-panel-slot="title">\s*<\/div>/],
  ["an empty titlebar, crumb, list row, or Dash tile",
    /class="?(?:up-titlebar-text|up-pathbar-label|up-post-title|up-dash-tile-label)"?>\s*</],
];

function blankTitles(out: string): string[] {
  return readdirSync(out, { encoding: "utf8", recursive: true })
    .filter((f) => /\.(html|xml)$/.test(f))
    .flatMap((f) => {
      const text = read(join(out, f));
      return BLANK_TITLES.filter(([, re]) => re.test(text)).map(([what]) => `${f} has ${what}`);
    });
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

// A grayscale PNG of the given size, for sites whose checks need Hugo to
// read and resize an image. It is black unless fill is "checkered",
// which alternates black and white pixels that WebP encodes far larger
// than PNG does. stored leaves the pixels uncompressed, as an
// unoptimized export does, so WebP shrinks the image. A nonzero
// orientation adds an Exif Orientation tag with that value, as a phone
// photo carries.
type PngOptions = { fill?: "black" | "checkered"; stored?: boolean; orientation?: number };
function png(width: number, height: number, { fill = "black", stored = false, orientation = 0 }: PngOptions = {}): Uint8Array {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  // Width, height, bit depth 8, and color type 0, which is grayscale.
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  // Each row is a filter byte, which is 0, and then one byte per pixel.
  const rows = Buffer.alloc((width + 1) * height);
  if (fill === "checkered") {
    for (let y = 0; y < height; y++) {
      for (let x = y % 2; x < width; x += 2) rows[y * (width + 1) + 1 + x] = 255;
    }
  }
  const pixels = deflateSync(rows, stored ? { level: 0 } : {});
  // A big-endian TIFF header and one IFD entry, Orientation (0x0112), a
  // SHORT that holds the value.
  const exif = Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(orientation ? [chunk("eXIf", exif)] : []),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// A share image as a built page's Open Graph tags describe it.
type ShareImage = { url: string; width?: number; height?: number; alt?: string };

// A built page's og:image tags, each with the structured properties that
// follow it before the next og:image.
function shareImages(html: string): ShareImage[] {
  const images: ShareImage[] = [];
  for (const [, field, value = ""] of html.matchAll(/<meta property="og:image(?::(width|height|alt))?" content="([^"]*)">/g)) {
    if (!field) images.push({ url: value });
    const last = images.at(-1);
    if (last && field === "alt") last.alt = value;
    if (last && (field === "width" || field === "height")) last[field] = Number(value);
  }
  return images;
}

// The JSON-LD fields the checks read. JSON.parse does not check them.
type LdNode = {
  "@id"?: string;
  "@type"?: string;
  "@graph"?: LdNode[];
  author?: LdNode;
  isPartOf?: LdNode;
  publisher?: LdNode;
  [field: string]: unknown;
};

// A built page's JSON-LD block, or an empty node when it has none.
function jsonld(html: string): LdNode {
  const m = /<script type="?application\/ld\+json"?>([^<]*)<\/script>/.exec(html);
  return m ? JSON.parse(m[1]!) : {};
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
    const links = site.hosts
      ? Object.entries(site.hosts).flatMap(([dir, url]) => brokenLinks(join(out, dir), url).map((p) => `${dir}/: ${p}`))
      : brokenLinks(out, siteBaseURL(source, flags));
    const problems = [...(site.check?.(out, source) ?? []), ...links, ...blankTitles(out)]
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
