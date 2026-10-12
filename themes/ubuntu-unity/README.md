# ubuntu-unity

A personal-site Hugo theme styled after the Ubuntu 14.04 Unity desktop. Your pages render inside a draggable desktop window under a top panel with working indicator menus and a launcher dock, and the home page is an interactive terminal.

![The home terminal inside the Unity desktop](https://raw.githubusercontent.com/MacroPower/macropower.github.io/main/themes/ubuntu-unity/images/screenshot.png)

**Demo:** [jacobcolvin.com](https://jacobcolvin.com), or run the bundled [example site](#example-site).

## Features

- **Home terminal.** An xterm.js shell with a bash-like parser (pipes, redirections, globbing, command substitution, arithmetic), a writable virtual filesystem seeded from your content, about 60 commands, tab completion, history, and a neofetch banner built from your site params. A differential test suite checks the shell core against real bash.
- **Desktop chrome.** Top panel menus and indicators, launcher dock, Dash search (Super), HUD menu search (Alt), lock screen, NotifyOSD bubbles, and a trash window.
- **Blog.** A Nautilus-style post list with filtering, sorting, search, category and series lenses, a focused post reader, and a posts-only RSS feed.
- **Projects page.** An icon-grid file manager over a YAML data file, with drag-to-reorder, rubber-band selection, and a preview pane.
- **CV page.** An Evince-style PDF viewer (vendored pdf.js) with thumbnails, zoom, and print and source actions.
- **Solitaire page.** Klondike on a pixel-art table with synthesized sound, undo, hints, and auto-complete. The rules are a tested, DOM-free module.
- **Extras.** A sponsors page, an icon vault, a spotify shortcode, Open Graph, Twitter, and JSON-LD metadata, self-hosted Ubuntu fonts, and a MIDI synth "Studio" that plays your site's MIDI files from the sound indicator.

Hugo partials server-render everything, and Hugo's built-in esbuild bundles the TypeScript and the stylesheet, so a site needs nothing but Hugo: no Node, npm, or Dart Sass. Each page loads only the bundles it uses. Desktop state is session-only, so a reload gives you a fresh desktop.

## Requirements

- Hugo 0.165.0 or later. The standard edition works.
- Go, if you install the theme as a Hugo module.

## Installation

The theme lives under `themes/ubuntu-unity` in the [macropower.github.io](https://github.com/MacroPower/macropower.github.io) repository and carries its own `go.mod`, so Hugo can import it directly from that path.

### Hugo module

```bash
hugo mod init github.com/you/yoursite
```

```toml
# hugo.toml
[module]
  [[module.imports]]
    path = "github.com/MacroPower/macropower.github.io/themes/ubuntu-unity"
```

```bash
hugo mod get -u
```

### Git submodule

```bash
git submodule add https://github.com/MacroPower/macropower.github.io themes/macropower
```

```toml
# hugo.toml
theme = "ubuntu-unity"
themesDir = "themes/macropower/themes"
```

### Copy

```bash
git clone --depth 1 https://github.com/MacroPower/macropower.github.io /tmp/mp
cp -r /tmp/mp/themes/ubuntu-unity themes/ubuntu-unity
echo 'theme = "ubuntu-unity"' >> hugo.toml
```

## Configuration

`exampleSite/hugo.toml` documents every option with comments. The short version:

```toml
baseURL = "https://example.org/"
title   = "Jane Doe"
theme   = "ubuntu-unity"

[taxonomies]
  category = "categories"
  series   = "series"

[params]
  description = "Jane Doe's personal site."

  [params.author]
    name     = "Jane Doe"
    email    = "jane@example.org"
    jobTitle = "Software Engineer"   # terminal banner "title" row
    focus    = "Distributed Systems" # focus line under it
    # born = "1990-01-31"  # banner uptime = your age; else site age

  [[params.social]]
    name = "github"
    url  = "https://github.com/jane"

[menu]
  [[menu.main]]
    identifier = "blog"
    name       = "Blog"
    url        = "posts/"
    weight     = 2
```

### Params

| Param | Default | Purpose |
| --- | --- | --- |
| `description` | | `<meta name="description">` and the RSS channel description. |
| `images` | | Default share image for Open Graph and Twitter cards. |
| `themeColor` | | Emitted as `<meta name="theme-color">`. |
| `repoUrl` | | Linked from Help > View source. |
| `author.name`, `author.email` | site title | The banner name, JSON-LD author, and the Messages indicator's Compose target. A plain string `author = "Jane Doe"` sets the name. |
| `author.jobTitle`, `author.focus` | | The terminal banner's title row and the focus line under it. `jobTitle` is also the home page's JSON-LD `jobTitle`. |
| `author.born` | | Makes the banner's uptime your age. Otherwise it counts from your oldest page. |
| `social` | | A list of `{name, url, short}`. Rows in the banner, links in JSON-LD. A `github` entry also backs the session menu and sponsors button; a `twitter` entry sets the card metadata. |
| `desktop.accent` | `orange` | The starting accent preset: `orange`, `green`, `aubergine`, or `blue`. Visitors can switch it in Edit > Preferences. |
| `desktop.label` | your name and a version line | The lines of the desktop's corner watermark. An empty list removes it. |
| `desktop.trash` | six joke files | The names in the Trash window. A trailing slash marks a folder. |
| `desktop.networks` | three access points | The network indicator's access points, of which the first starts connected. An entry is a name or a `{name, mono}` table. |
| `blog.dateFormat`, `blog.listDateFormat` | `Jan 2, 2006`, `2006-01-02` | Date formats in the post reader and post list. |
| `blog.readingTime` | `true` | Shows "N min read" in the post reader. |
| `blog.taxonomies.category`, `blog.taxonomies.series` | `categories`, `series` | The taxonomies behind the blog's Places and Series lenses and the post chips. Set `category = "tags"` for a site that tags its posts. |
| `terminal.user`, `terminal.host` | `user`, host of `baseURL` | The login the home terminal presents. |
| `projects.minStars`, `projects.minForks`, `projects.recentMonths` | `100`, `6`, `6` | The thresholds behind the projects sidebar's Starred, Forks, and Recent filters. |
| `studio.playlist` | `assets/midi/*.mid` and `*.midi`, by file name | MIDI files under `assets/` that the Studio plays, in order. |

### Menu

`menu.main` drives the launcher dock, the Dash's Applications category, the File menu, and the panel's navigation actions. Home is implicit and always first. Per-entry `[menu.main.params]` accept `icon`, `match` (`"exact"` or `"prefix"`), `kw` (Dash keywords), `dashLabel`, `dashIcon`, and the `launcher` and `dash` booleans that keep a page off the dock or out of the Dash. `launcher = "running"` docks a page only while it is open. Known identifiers (`cv`, `blog`, `posts`, `projects`, `sponsors`, `icons`, `solitaire`, `about`) get fitting icons and keywords automatically.

## Content

- `content/posts/*.md` are blog posts. `categories` and `series` front matter feed the sidebar lenses, and `params.blog.taxonomies` points either lens at another taxonomy. The theme finds the blog section through Hugo's `mainSections`, so `content/blog/` works too.
- `content/cv.md` with `layout = "cv"` is the PDF viewer. Front matter: `pdf` (required), `pdfPrintable`, `sourceUrl`. The viewer runs on Chrome 125, Safari 18, Firefox ESR, and later. Older browsers get a link to the PDF.
- `content/sponsors.md` with `layout = "sponsors"` renders cards from `data/sponsors.yaml`. Each entry has `name`, `url`, and an optional `avatar`. The "Become a sponsor" button points at `sponsorUrl` from the page's front matter, or else at GitHub Sponsors for your `github` social entry.
- `content/projects.md` with `layout = "projects"` renders the grid from `data/projects.yaml`. See `exampleSite/data/projects.yaml` for the schema. Any language name works. The theme draws its own emblem for Go, Python, TypeScript, JavaScript, Rust, Shell, C, HTML, Ruby, and Lua, and a generic one for the rest.
- `content/solitaire.md` with `layout = "solitaire"` is the solitaire table. The terminal's `solitaire` command opens it.
- `content/icons.md` with `layout = "icons"` is the icon vault, a copy-to-clipboard catalogue of every SVG the theme ships.
- `assets/midi/*.mid` files are the Studio's playlist. The theme ships none, and a site without any gets no Studio.
- Any other top-level page renders in a plain window and appears in the terminal's filesystem, where `cat` prints its markdown.

`hugo new posts/my-post.md` uses the theme's `archetypes/posts.md`.

### Markdown

The theme's render hooks extend Hugo's Markdown:

- **Links and images.** A relative link or image resolves to a page, then a file in the page's bundle, then a file under `assets/`, so `[intro](other-post.md)` and `![](photo.jpg)` beside an `index.md` both work. Images Hugo can read get a width and height.
- **Headings.** Every heading ends with a `#` link to itself, which shows on hover. Feeds get the plain heading.
- **Alerts.** GitHub-style alerts render as info bars. The types are `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`, text after the marker replaces the title, and a `+` or `-` after the type makes the alert collapsible, open or closed:

  ```markdown
  > [!WARNING]- Read this first
  > The alert starts collapsed.
  ```

- **Math.** With Goldmark's passthrough extension enabled, TeX between the delimiters renders to MathML at build time, so math needs no script or stylesheet:

  ```toml
  [markup.goldmark.extensions.passthrough]
    enable = true
    [markup.goldmark.extensions.passthrough.delimiters]
      block  = [['\[', '\]'], ['$$', '$$']]
      inline = [['\(', '\)']]
  ```

## Customizing

- **Extra CSS.** Add `assets/css/custom.css` to your site. The theme appends it to its own stylesheet, so your rules win on equal specificity. It goes through the same `css.Build` pass as the theme's stylesheet, so it can use native nesting and `@import` other files under `assets/css/`. Every theme selector is prefixed `up-`, and the palette lives in CSS custom properties on `:root`.
- **Extra head or body markup.** Add `layouts/_partials/extend-head.html` or `layouts/_partials/extend-footer.html` to your site. The theme renders the first at the end of `<head>` and the second just before `</body>`, after its own bundles.
- **Comments.** Add `layouts/_partials/extend-post.html` to your site. The post reader renders it after each post's body, with the post as its context.
- **Analytics.** Set `services.googleAnalytics.id` and production builds include Hugo's Google Analytics tag. For any other provider, use `extend-head.html`.
- **Translations.** Copy `i18n/en.toml` to `i18n/<lang>.toml` in your site and translate the values. Text the JavaScript writes at runtime stays in English.
- **Languages.** On a multilingual site, a language badge joins the top panel's indicators. Its menu lists every language and leads to the current page's translation, or to that language's home page when the page has none.
- **Favicons.** Drop `favicon.svg`, `favicon.ico`, and `apple-touch-icon.png` into your site's `static/` to replace the theme's.
- **Terminal ascii art.** Override `assets/home/ascii.txt` (the art) and `assets/home/colors.txt` (a same-shape color mask using `O Y G B P C R M`, with space for no color).
- **Terminal login.** The prompt reads `user@<host of baseURL>`. Set `params.terminal.user` and `params.terminal.host` to change either half.
- **Language emblems.** Add a `<symbol id="lang-<Name>">` to `assets/icons/glyphs/lang-symbols.svg` in your site to give a project language its own emblem.
- **Anything else.** Copy a file from the theme's `layouts/` into your site's `layouts/` at the same path and edit it.

## Example site

```bash
cd themes/ubuntu-unity
hugo server -s exampleSite --themesDir ../..
```

The example site uses every layout, shortcode, and render hook, so `hugo --printUnusedTemplates` against it reports nothing.

## Development

```bash
npm install
npm run typecheck        # production sources
npm run typecheck:test   # test sources
npm test                 # vitest: shell core, bash conformance, MIDI, solitaire
npm run test:sites       # hugo: the example site and bare sites, warnings fatal
```

The theme vendors xterm.js and pdf.js under `assets/vendor/`, so sites build without npm. To upgrade either, edit the version in `scripts/vendor-xterm.mjs` or `scripts/vendor-pdfjs.mjs` and run `npm run vendor:xterm` or `npm run vendor:pdfjs`.

The bash-conformance suite skips itself where bash is absent.

## License

Apache-2.0. See [LICENSE.md](LICENSE.md).

- [Ubuntu font family](https://design.ubuntu.com/font), self-hosted subsets under the [Ubuntu font licence](https://ubuntu.com/legal/font-licence).
- [xterm.js](https://xtermjs.org/) 6.0.0 (MIT), vendored under `assets/vendor/xterm/`.
- [pdf.js](https://mozilla.github.io/pdf.js/) 6.4.299 legacy build (Apache-2.0), vendored under `assets/vendor/pdf-js/`.
- Ubuntu and Unity are trademarks of Canonical Ltd. This theme is a fan recreation and is not affiliated with or endorsed by Canonical.
