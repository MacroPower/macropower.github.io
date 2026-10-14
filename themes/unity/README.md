# unity

A personal-site Hugo theme styled after the Ubuntu 14.04 Unity desktop. Your pages render inside a draggable desktop window under a top panel with working indicator menus and a launcher dock, and the home page is an interactive terminal.

![The home terminal inside the Unity desktop](https://raw.githubusercontent.com/MacroPower/macropower.github.io/main/themes/unity/images/screenshot.png)

**Demo:** [jacobcolvin.com](https://jacobcolvin.com), or run the bundled [example site](#example-site).

## Features

- **Home terminal.** An xterm.js shell with a bash-like parser (pipes, redirections, globbing, command substitution, arithmetic), a writable virtual filesystem seeded from your content, about 60 commands, tab completion, history, and a neofetch banner built from your site params. A differential test suite checks the shell core against real bash. A site that prefers a plain home page can switch the terminal off.
- **Desktop chrome.** Top panel menus and indicators, launcher dock, Dash search (Super), HUD menu search (Alt), lock screen, NotifyOSD bubbles, and a trash window. The HUD, the lock screen, and the Trash each switch off with one param.
- **Blog.** A Nautilus-style post list with filtering, sorting, search, category and series lenses, a focused post reader, and a posts-only RSS feed.
- **Projects page.** An icon-grid file manager over a YAML data file or your GitHub repositories, with drag-to-reorder, rubber-band selection, and a preview pane.
- **CV page.** An Evince-style PDF viewer (vendored pdf.js) with thumbnails, zoom, and print and source actions.
- **Solitaire page.** Klondike on a pixel-art table with synthesized sound, undo, hints, auto-complete, and a keyboard cursor that plays every move. The rules are a tested, DOM-free module.
- **Translations.** Every label, dialog, and notification goes through Hugo's i18n, and a string your translation lacks shows in English rather than empty. Dates and the calendar follow the page's language, post bodies lay out right to left where the language does, and a multilingual site gets a language indicator in the top panel.
- **Markdown.** Heading anchors, GitHub-style alerts, build-time MathML math, and responsive images.
- **Accessibility and print.** A skip link, real landmarks, keyboard focus that follows each window, and a print stylesheet that puts a post on plain paper without the desktop.
- **Content Security Policy.** The theme renders no inline script, style element, or style attribute, so its pages run under `script-src 'self'` and `style-src 'self'`. See [Customizing](#customizing) for the one exception.
- **Extras.** A sponsors page, an icon vault, a spotify shortcode, Open Graph, Twitter, and JSON-LD metadata, self-hosted Ubuntu fonts, and a MIDI synth "Studio" that plays your site's MIDI files from the sound indicator.

Hugo partials server-render everything, and Hugo's built-in esbuild bundles the TypeScript and the stylesheet, so a site needs nothing but Hugo: no Node, npm, or Dart Sass. Each page loads only the bundles it uses. Desktop state is session-only, so a reload gives you a fresh desktop.

## Requirements

- Hugo 0.165.0 or later. The standard edition works.
- Git and Go 1.18 or later, if you install the theme as a Hugo module.

## Installation

The theme lives under `themes/unity` in the [macropower.github.io](https://github.com/MacroPower/macropower.github.io) repository and carries its own `go.mod`, so Hugo can import it directly from that path. A Hugo module is the recommended route.

### Hugo module

```bash
hugo mod init github.com/you/yoursite
```

```toml
# hugo.toml
[module]
  [[module.imports]]
    path = "github.com/MacroPower/macropower.github.io/themes/unity"
```

```bash
hugo mod get -u
```

Run `hugo mod get -u` again to update. The theme has no release tags yet, so Hugo pins the latest commit on `main`.

The theme does not add Node packages to `hugo mod npm pack`, so a site that runs it to install another module's packages, such as Tailwind CSS, installs nothing for the theme.

### Git submodule

Git cannot add one directory of a repository as a submodule, so add the whole repository and point `theme` at the theme inside it:

```bash
git submodule add https://github.com/MacroPower/macropower.github.io themes/macropower
echo 'theme = "macropower/themes/unity"' >> hugo.toml
```

The submodule checks out the whole site repository, including its posts and images, not only the theme. Run `git submodule update --remote` to update, then commit `themes/macropower` to record the new revision. A plain `git clone` of your site leaves `themes/macropower` empty. Clone it with `--recurse-submodules`, and set your CI's checkout to fetch submodules.

### Copy

A sparse clone fetches only the theme's files, not the rest of the site around it:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/MacroPower/macropower.github.io /tmp/mp
git -C /tmp/mp sparse-checkout set themes/unity
cp -r /tmp/mp/themes/unity themes/unity
echo 'theme = "unity"' >> hugo.toml
```

To update a copy, delete `themes/unity` and copy the theme again from a fresh sparse clone.

## Configuration

`exampleSite/hugo.toml` documents every option with comments. The short version:

```toml
baseURL = "https://example.org/"
title   = "Jane Doe"
theme   = "unity"

# The blog section. Without it, Hugo picks the section with the most
# pages, which may not be the blog.
mainSections = ["posts"]

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
    pageRef    = "/posts"
    weight     = 2
```

The theme also reads two of Hugo's own settings: `copyright` fills each feed's copyright, and `services.rss.limit` caps how many posts a feed lists.

### Site settings

Hugo merges only `params`, `menus`, `mediaTypes`, and `outputFormats` from a theme's configuration, so the theme cannot set these for you:

- `mainSections` names the blog section. Without it, Hugo picks the section with the most pages.
- `[taxonomies]` must list `series` for the Series lens, because Hugo's defaults are `tags` and `categories`.
- `enableRobotsTXT = true` publishes the theme's `robots.txt`, which points crawlers at the sitemap.
- `[markup.goldmark.extensions.passthrough]` turns on math. See [Markdown](#markdown).
- `[build] noJSConfigInAssets = true` stops Hugo from writing an `assets/jsconfig.json` into your site each time it bundles the theme's scripts. Leave it unset if your editor reads that file.

### Params

| Param | Default | Purpose |
| --- | --- | --- |
| `description` | | `<meta name="description">` and the RSS channel description. |
| `images` | | Default share image for Open Graph and Twitter cards. |
| `themeColor` | | Emitted as `<meta name="theme-color">`. |
| `repoUrl` | | Linked from Help > View source, which shows only when this is set. |
| `author.name`, `author.email` | site title | The banner name, JSON-LD author, and the Messages indicator's Compose target. A plain string `author = "Jane Doe"` sets the name. |
| `author.jobTitle`, `author.focus` | | The terminal banner's title row and the focus line under it. `jobTitle` is also the home page's JSON-LD `jobTitle`. |
| `author.born` | | Makes the banner's uptime your age. Otherwise it counts from your oldest page. |
| `social` | | A list of `{name, url, short}`, or a table of `name = "url"` pairs. Rows in the banner, links in JSON-LD. A `github` entry also backs the sponsors button. Every entry on GitHub, GitLab, Codeberg, Bitbucket, or sourcehut gets a link in the projects sidebar, and a `twitter` entry sets the card metadata. |
| `desktop.accent` | `orange` | The starting accent preset: `orange`, `green`, `aubergine`, or `blue`. Visitors can switch it in Edit > Preferences. |
| `desktop.label` | your name and a version line | The lines of the desktop's corner watermark. An empty list removes it. |
| `desktop.trash` | six joke files | The names in the Trash window. A trailing slash marks a folder. `false` removes the Trash. |
| `desktop.lock` | `true` | `false` removes the lock screen and the Lock and Log Out actions. |
| `desktop.hud` | `true` | `false` removes the HUD and its Alt tap, which some keyboard and screen reader users rely on for the browser's own menus. |
| `desktop.user`, `desktop.host` | the author's first name, `unity` | The owner's login on the lock screen, the user menu, the Trash, and the post sign-offs. |
| `desktop.hotspot` | `personal-site` | The network name the network indicator's hotspot broadcasts. |
| `desktop.networks` | three access points | The network indicator's access points, of which the first starts connected. An entry is a name or a `{name, mono}` table. |
| `blog.dateFormat`, `blog.listDateFormat` | `:date_medium`, `2006-01-02` | Date formats in the post reader and post list. Hugo's `:date_medium` follows the page's language. |
| `blog.readingTime` | `true` | Shows "N min read" in the post reader. |
| `blog.toc` | `false` | Opens each post with a table of contents when it has two headings or more. A post's `toc` front matter overrides it. |
| `blog.feedFullContent` | `false` | Puts each post's whole body in the RSS feed instead of its summary. |
| `blog.taxonomies.category`, `blog.taxonomies.series` | `categories`, `series` | The taxonomies behind the blog's Places and Series lenses and the post chips. Set `category = "tags"` for a site that tags its posts. |
| `home.layout` | `terminal` | `page` renders the home's content in a plain window instead of the terminal. |
| `terminal.user`, `terminal.host` | `user`, host of `baseURL` | The guest login a visitor gets in the home terminal. |
| `projects.github` | | A GitHub account whose public repositories fill the projects page when the site has no `data/projects.yaml`. |
| `projects.minStars`, `projects.minForks`, `projects.recentMonths` | `100`, `6`, `6` | The thresholds behind the projects sidebar's Starred, Forks, and Recent filters. |
| `studio.playlist` | `assets/midi/*.mid` and `*.midi`, by file name | MIDI files under `assets/` that the Studio plays, in order. An entry is a path or a `{path, title}` table. A track without a title shows as "Track N". |

### Menu

`menu.main` drives the launcher dock, the Dash's Applications category, the File menu, and the panel's navigation actions. Home is implicit and always first. Point an entry at a page with `pageRef`, which follows the page's permalink and language, or at any other address with `url`. Per-entry `[menu.main.params]` accept `icon` (an SVG name under `assets/unity/icons/`, such as `launcher/cv`, which your site may add to), `match` (`"exact"` or `"prefix"`), `kw` (Dash keywords), `dashLabel`, `dashIcon`, and the `launcher` and `dash` booleans that keep a page off the dock or out of the Dash. `launcher = "running"` docks a page only while it is open. Known identifiers (`cv`, `blog`, `posts`, `projects`, `sponsors`, `icons`, `solitaire`, `about`) get fitting icons and keywords automatically.

## Content

- `content/posts/*.md` are blog posts. `categories` and `series` front matter feed the sidebar lenses, and `params.blog.taxonomies` points either lens at another taxonomy. The theme finds the blog section through Hugo's `mainSections`, so `content/blog/` works too. Posts may sit in nested sections such as `content/posts/2024/`, and each section's list shows the posts at any depth below it. A list shows every post and filters and sorts them in the browser, so Hugo's `pagination` settings do not apply. A site without sections has no blog, and its pages render as plain windows.
- Any page accepts `noindex = true`, which asks search engines to skip it and keeps it out of the sitemap, and `slug`, which also names the page's file in the home terminal. `description` and `images` set the page's search and share metadata, and `canonicalURL` points its canonical link at the original of a syndicated post.
- `content/cv.md` with `layout = "cv"` is the PDF viewer. Front matter: `pdf` (required), `pdfPrintable`, `sourceUrl`. The viewer runs on Chrome 125, Safari 18, Firefox ESR, and later. Older browsers get a link to the PDF.
- `content/sponsors.md` with `layout = "sponsors"` renders cards from `data/sponsors.yaml`. Each entry has `name`, `url`, and an optional `avatar`. The "Become a sponsor" button points at `sponsorUrl` from the page's front matter, or else at GitHub Sponsors for your `github` social entry.
- `content/projects.md` with `layout = "projects"` renders the grid from `data/projects.yaml`. See `exampleSite/data/projects.yaml` for the schema, in which only `name` is required. Without that file, set `params.projects.github` to your GitHub account, and the build fetches up to 100 of its public repositories with a language, skipping forks and archived ones. Set the `HUGO_GITHUB_TOKEN` environment variable to lift the GitHub API's rate limit for anonymous requests. Any language name works. The theme draws its own emblem for Go, Python, TypeScript, JavaScript, Rust, Shell, C, HTML, Ruby, and Lua, and a generic one for the rest.
- `content/solitaire.md` with `layout = "solitaire"` is the solitaire table. The terminal's `solitaire` command opens the first page with that layout.
- `content/icons.md` with `layout = "icons"` is the icon vault, a copy-to-clipboard catalogue of every SVG the theme ships.
- `assets/midi/*.mid` files are the Studio's playlist. The theme ships none, and a site without any gets no Studio.
- Any other top-level page renders in a plain window and appears in the terminal's filesystem, where `cat` prints its markdown.
- `content/_index.md` titles the home page, and its body becomes `~/README.md` in the terminal. Without a body, the terminal writes its own welcome there.

`hugo new posts/my-post.md` uses the theme's `archetypes/posts.md`. For a blog section with another name, copy that file to `archetypes/<section>.md` in your site.

### Markdown

The theme's render hooks extend Hugo's Markdown:

- **Links and images.** A relative link or image resolves to a page, then a file in the page's bundle, then a file under `assets/`, so `[intro](other-post.md)` and `![](photo.jpg)` beside an `index.md` both work. A root-relative path that matches none of them, such as `/files/cv.pdf`, resolves under your `baseURL`, so it keeps working on a site served from a subdirectory. Images Hugo can read get a width and height. Feeds get absolute URLs, and an alert becomes a plain blockquote led by its title.
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

- **Extra CSS.** Add `assets/css/custom.css` to your site. The theme appends it to its own stylesheet, so your rules win on equal specificity. It goes through the same `css.Build` pass as the theme's stylesheet, so it can use native nesting and `@import` other files under `assets/unity/css/`. Every theme selector is prefixed `up-`, and every custom property is prefixed `--up-`. The palette lives in custom properties on `:root`, and `--up-accent` holds the accent preset's color.
- **Extra head or body markup.** Add `layouts/_partials/extend-head.html` or `layouts/_partials/extend-footer.html` to your site. The theme renders the first at the end of `<head>` and the second just before `</body>`. The theme's scripts are deferred and run after yours, so a script that calls `window.uiDialog` waits for the `up:ready` event on `document`. A script that may run later, such as a module script, first checks for the `up-ready` class on `<body>`, which the theme sets just before the event. A script raises a notification bubble by dispatching an `up:notify` event on `window`:

  ```js
  window.dispatchEvent(new CustomEvent("up:notify", {
    detail: { summary: "Saved", body: "Your draft is safe.", icon: "info" },
  }));
  ```
- **Script API.** Your site's TypeScript can import the theme's script API from `unity/js/api`, and Hugo's `js.Build` resolves the import from the theme's assets. The other modules under `unity/js/` are internal, so import only `unity/js/api`.

  `notify()` raises a notification bubble. `dialog()` opens a dialog with the options of `window.uiDialog`, which the exported `UPDialogOptions` type lists. It resolves to the id of the button that closed the dialog, or to `null` when Escape or the close button closed it. tsc narrows that result to the ids in the call's `buttons`. Both functions wait for the desktop to start, so a script can call them at any time. `whenReady()` returns a promise that resolves when the desktop has started.

  ```ts
  // assets/js/site.ts
  import { dialog, notify } from "unity/js/api";

  notify({ summary: "Welcome back", icon: "info" });

  document.querySelector("#clear-draft")?.addEventListener("click", async () => {
    const choice = await dialog({
      title: "Clear the draft?",
      icon: "question",
      buttons: [
        { id: "keep", label: "Keep" },
        { id: "clear", label: "Clear", primary: true, danger: true },
      ],
    });
    if (choice === "clear") localStorage.removeItem("draft");
  });
  ```

  ```go-html-template
  {{/* layouts/_partials/extend-footer.html */}}
  {{ with resources.Get "js/site.ts" | js.Build (dict "minify" hugo.IsProduction) | fingerprint }}
    <script defer src="{{ .RelPermalink }}" integrity="{{ .Data.Integrity }}"></script>
  {{ end }}
  ```

  Hugo writes `assets/jsconfig.json` on each build, and it maps imports to the theme's assets wherever the theme lives, whether under `themes/`, in Hugo's module cache, or under `_vendor/`. To type-check your scripts with TypeScript 5.4 or later, extend that file from your site's `tsconfig.json` and run `tsc` after a build:

  ```json
  {
    "extends": "./assets/jsconfig.json",
    "compilerOptions": {
      "lib": ["es2023", "dom"],
      "module": "preserve",
      "moduleResolution": "bundler",
      "strict": true,
      "noEmit": true
    },
    "include": ["assets/js"]
  }
  ```
- **Comments.** Add `layouts/_partials/extend-post.html` to your site. The post reader renders it after each post's body, with the post as its context.
- **Content Security Policy.** The theme renders no inline script, event handler, style element, or style attribute, so its pages work under `script-src 'self'` and `style-src 'self'`, with or without JavaScript. When JavaScript runs, the home terminal needs `style-src 'unsafe-inline'`, because xterm.js adds style elements at runtime. Hugo's Google Analytics tag is an inline script. Hugo's default syntax highlighting writes style attributes, so set `markup.highlight.noClasses = false`, and the theme's stylesheet carries the classes for your `markup.highlight.style`.
- **Analytics.** Set `services.googleAnalytics.id` and production builds include Hugo's Google Analytics tag. For any other provider, use `extend-head.html`.
- **Translations.** Copy `i18n/en.toml` to `i18n/<lang>.toml` in your site and translate the values. That covers the desktop's dialogs and notifications too, whose keys start with `js_` and use `{name}` placeholders instead of Go templates. The `kw_` keys hold the words the Dash search matches, so a translation can add words in its own language. A key your file leaves out shows the theme's English, whatever your default language, and the build warns once per language with the keys your file lacks. List `unity-i18n-missing` in `ignoreLogs` to silence that warning. The home terminal stays in English, like the bash it imitates.
- **Languages.** On a multilingual site, a language badge joins the top panel's indicators. Its menu lists every language and leads to the current page's translation, or to that language's home page when the page has none. The badge shows the first two letters of the language's name, and `[languages.<lang>.params.desktop] languageBadge` replaces them, so `pt` and `pt-br` can read `Pt` and `Br`.
- **Favicons.** Drop `favicon.svg`, `favicon.ico`, and `apple-touch-icon.png` into your site's `static/` to replace the theme's.
- **Terminal ascii art.** Override `assets/unity/home/ascii.txt` (the art) and `assets/unity/home/colors.txt` (a same-shape color mask using `O Y G B P C R M`, with space for no color).
- **Terminal login.** The prompt reads `user@<host of baseURL>`. Set `params.terminal.user` and `params.terminal.host` to change either half.
- **Language emblems.** Copy the theme's `assets/unity/icons/glyphs/lang-symbols.svg` to the same path in your site and add a `<symbol id="lang-<Name>">` to give a project language its own emblem. Your copy replaces the theme's whole sprite, so start from the theme's file.
- **Anything else.** Copy a file from the theme's `layouts/` into your site's `layouts/` at the same path and edit it. The theme keeps its partials under `layouts/_partials/unity/`, so your site's own partials, such as `_partials/head.html` or `_partials/author.html`, never replace them. To override one, copy it to `layouts/_partials/unity/<path>` in your site. The `extend-*` hooks stay at the top of `layouts/_partials/`, because they are yours to add. The theme keeps its own assets under `assets/unity/`, so your site's `assets/css/`, `assets/js/`, and `assets/icons/` never replace them, and a copy under `assets/unity/` overrides the theme's file at that path.

## Example site

```bash
cd themes/unity
hugo server -s exampleSite --themesDir ../..
```

The example site uses every layout, shortcode, and render hook, so `hugo --printUnusedTemplates` against it reports nothing.

## Development

```bash
npm install
npm run typecheck        # production sources
npm run typecheck:test   # test sources
npm run typecheck:node   # dev scripts and Vitest config
npm run lint             # biome lint over the scripts and tooling
npm test                 # vitest: shell core, bash conformance, MIDI, solitaire
npm run test:sites       # hugo: the example site and bare sites, warnings fatal
```

The dev tooling needs Node 22.18 or later, the first Node 22 release that runs the TypeScript under `scripts/` without a flag.

The theme vendors xterm.js and pdf.js under `assets/unity/third_party/`, so sites build without npm. To upgrade either, edit the version in `scripts/vendor-xterm.ts` or `scripts/vendor-pdfjs.ts` and run `npm run vendor:xterm` or `npm run vendor:pdfjs`.

The bash-conformance suite skips itself where bash is absent. The suite that checks Hugo's output against the scripts' types builds the example site and a bare site. It skips itself where Hugo is absent.

## License

Apache-2.0. See [LICENSE.md](https://github.com/MacroPower/macropower.github.io/blob/main/themes/unity/LICENSE.md).

- [Ubuntu font family](https://design.ubuntu.com/font) 0.83 ([Ubuntu Font Licence 1.0](https://ubuntu.com/legal/font-licence)), self-hosted subsets under `assets/unity/fonts/`. The licence text is in `LICENCE.txt` and Canonical's copyright notice is in `copyright.txt` in the same directory.
- [xterm.js](https://xtermjs.org/) 6.0.0 (MIT), vendored under `assets/unity/third_party/xterm/`.
- [pdf.js](https://mozilla.github.io/pdf.js/) 6.4.299 legacy build (Apache-2.0), vendored under `assets/unity/third_party/pdf-js/`.
- Ubuntu and Unity are trademarks of Canonical Ltd. This theme is a fan recreation and is not affiliated with or endorsed by Canonical.
