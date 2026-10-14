# unity

A personal-site Hugo theme styled after the Ubuntu 14.04 Unity desktop. Your pages render inside a draggable desktop window under a top panel with working indicator menus and a launcher dock, and the home page is an interactive terminal.

![The home terminal inside the Unity desktop](https://raw.githubusercontent.com/MacroPower/macropower.github.io/main/themes/unity/images/screenshot.png)

**Demo:** [jacobcolvin.com](https://jacobcolvin.com), or run the bundled [example site](#example-site).

## Features

- **Home terminal.** An xterm.js shell with a bash-like parser (pipes, redirections, globbing, command substitution, arithmetic), a writable virtual filesystem seeded from your content, about 60 commands, tab completion, history, and a neofetch banner built from your site params. A differential test suite checks the shell core against real bash. A site that prefers a plain home page can switch the terminal off.
- **Desktop chrome.** Top panel menus and indicators, launcher dock, Dash search (Super), HUD menu search (Alt), lock screen, NotifyOSD bubbles, and a trash window. The HUD, the lock screen, and the Trash each switch off with one param, and another picks the panel's indicators and their order.
- **Blog.** A Nautilus-style post list with filtering, sorting, search, category and series lenses, a focused post reader, and a posts-only RSS feed.
- **Projects page.** An icon-grid file manager over a YAML data file or your GitHub repositories, with drag-to-reorder, rubber-band selection, and a preview pane.
- **CV page.** An Evince-style PDF viewer (vendored pdf.js) with thumbnails, zoom, and print and source actions.
- **Solitaire page.** Klondike on a pixel-art table with synthesized sound, undo, hints, auto-complete, and a keyboard cursor that plays every move. The rules are a tested, DOM-free module.
- **Translations.** Every label, dialog, and notification goes through Hugo's i18n, and a string your translation lacks shows in English rather than empty. Dates and the calendar follow the page's language, and a multilingual site gets a language indicator in the top panel. On a right-to-left language, the top panel and every window mirror, and the launcher stays on the left edge. Rows of menus, tiles, and projects run from right to left, so the Left arrow key moves to the next item. The shell prompts and the home terminal still read left to right there. Each title, tag, or other name in the desktop's panels, titlebars, lists, and Dash takes the direction of its first letter.
- **Markdown.** Heading anchors, GitHub-style alerts, build-time MathML math, and responsive images.
- **Accessibility and print.** A skip link, real landmarks, keyboard focus that follows each window, and a print stylesheet that puts a post on plain paper without the desktop. Focus rings, selections, and window edges stay visible in Windows contrast themes and other forced colors, and the focused window's titlebar fills with the system's highlight color. When a visitor's system asks for more contrast, each accent highlight behind white text, such as a selected row or a primary button, darkens so the text contrasts 4.5:1 or more. Each window's close, minimize, and maximize buttons respond to a click or tap anywhere in a 24px square around the button. When a visitor's system asks for reduced motion, or the visitor turns on Reduce motion in Edit > Preferences, the desktop stops its animations, transitions, and smooth scrolling.
- **Content Security Policy.** The theme renders no inline script, style element, or style attribute, so its pages run under `script-src 'self'` and `style-src 'self'`. See [Customizing](#customizing) for the one exception.
- **Extras.** A sponsors page, an icon vault, a spotify shortcode, Open Graph, Twitter, and JSON-LD metadata, self-hosted Ubuntu fonts, and a MIDI synth "Studio" that plays your site's MIDI files from the sound indicator.

Hugo partials server-render everything, and Hugo's built-in esbuild bundles the TypeScript and the stylesheet, so a site needs nothing but Hugo: no Node, npm, or Dart Sass. Each page loads only the bundles it uses. Desktop state is session-only, so a reload gives you a fresh desktop.

## Requirements

- Hugo 0.165.0 or later. The standard edition works.
- Git and Go 1.18 or later, if you install the theme as a Hugo module.
- A visitor's browser must be at least Chrome 115, Edge 115, Firefox 121, Opera 101, or Safari 16.4 on macOS or iOS.

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

# Take the theme's taxonomies and Markdown settings (see Site settings).
[taxonomies]
  _merge = "deep"

[markup]
  _merge = "deep"

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

The theme also reads two of Hugo's own settings. `copyright` takes Markdown, such as a link to your posts' license, and shows under each post and as plain text in each feed. `services.rss.limit` caps how many posts a feed lists.

### Site settings

Hugo merges a theme's `taxonomies` and `markup` into a site only when the site sets `_merge = "deep"` on its own table, as the configuration example does. The theme's own configuration cannot set `_merge` for you. Keys your site sets win over the theme's.

- `[taxonomies]` with `_merge` declares the theme's `categories` and `series` taxonomies, which back the blog's Places and Series lenses, in place of Hugo's default `categories` and `tags`. Add `tag = "tags"` beside `_merge` to keep tags. A site that merges the theme's taxonomies cannot remove any of them.
- `[markup]` with `_merge` turns on [math](#markdown) and highlights code with classes instead of style attributes, so highlighted code passes a [Content Security Policy](#customizing).

With `_merge` set, Hugo merges `markup` from every theme and module a site imports. A site that imports a module it does not trust copies the `[markup]` keys from the theme's `hugo.toml` instead of setting `_merge`.

The theme does not set these, so set them in your site:

- `mainSections` names the blog section. Without it, Hugo picks the section with the most pages.
- `enableRobotsTXT = true` publishes the theme's `robots.txt`, which points crawlers at the sitemap.
- `[build] noJSConfigInAssets = true` stops Hugo from writing an `assets/jsconfig.json` into your site each time it bundles the theme's scripts. Leave it unset if your editor reads that file.

### Params

| Param | Default | Purpose |
| --- | --- | --- |
| `description` | | `<meta name="description">` and the RSS channel description. Without it, a feed's description reads "Recent posts on" and the site's title, or the home page's title on a site without one. |
| `images` | | Default share image for Open Graph and Twitter cards. See [Content](#content) for how the theme sizes it. |
| `imageAlt` | | Alt text for the default share image. |
| `themeColor` | | Emitted as `<meta name="theme-color">`. |
| `repoUrl` | | Linked from Help > View source, which shows only when this is set. |
| `author.name`, `author.email` | site title | The banner name, JSON-LD author, and the Messages indicator's Compose target. A plain string `author = "Jane Doe"` sets the name. |
| `author.jobTitle`, `author.focus` | | The terminal banner's title row and the focus line under it. `jobTitle` is also the home page's JSON-LD `jobTitle`. |
| `author.born` | | A date such as `1990-01-31` that makes the banner's uptime your age. Otherwise the uptime counts from your oldest page, and a value that is not a date warns. |
| `social` | | A list of `{name, url, short}`, or a table of `name = "url"` pairs. Rows in the banner, links in JSON-LD, and `rel="me"` links on the home page, which Mastodon and IndieAuth read to verify the profiles. A `github` entry also backs the sponsors button. Every entry on GitHub, GitLab, Codeberg, Bitbucket, or sourcehut gets a link in the projects sidebar, and a `twitter` entry sets the card metadata. |
| `desktop.accent` | the first preset, `orange` | The accent preset each page starts with, named by its key under `desktop.accents`. Visitors can switch it in Edit > Preferences. |
| `desktop.accents` | `orange`, `green`, `aubergine`, `blue` | The accent presets that Edit > Preferences offers. See **Accent colors** under [Customizing](#customizing). |
| `desktop.wallpaper` | the aubergine gradient | An image that covers the desktop and the lock screen, given as a path under `assets/` or `static/` or as a URL. A `--up-wallpaper` that your `custom.css` sets beats it. |
| `desktop.label` | your name and a version line | The lines of the desktop's corner watermark. An empty list removes it. |
| `desktop.trash` | six joke files | The names in the Trash window. A trailing slash marks a folder. `false` removes the Trash. |
| `desktop.lock` | `true` | `false` removes the lock screen and the Lock and Log Out actions. |
| `desktop.hud` | `true` | `false` removes the HUD and its Alt tap, which some keyboard and screen reader users rely on for the browser's own menus. |
| `desktop.indicators` | `messages`, `network`, `sound`, `battery`, `clock`, `user` | The top panel's indicators, in order. Without `messages`, the panel loses its Compose and Subscribe actions. Without `sound`, the panel loses the Studio's player, but the Dash still opens the Studio. A multilingual site's language badge comes before the list. |
| `desktop.user`, `desktop.host` | the author's first name, `unity` | The owner's login on the lock screen, the user menu, the Trash, and the post sign-offs. |
| `desktop.hotspot` | `personal-site` | The network name the network indicator's hotspot broadcasts. |
| `desktop.networks` | three access points | The network indicator's access points, of which the first starts connected. An entry is a name or a `{name, mono}` table. |
| `blog.dateFormat`, `blog.listDateFormat` | `:date_medium`, `2006-01-02` | Date formats in the post reader and post list. `blog.dateFormat` also titles a post without a title. Hugo's `:date_medium` follows the page's language. |
| `blog.readingTime` | `true` | Shows "N min read" in the post reader. |
| `blog.toc` | `false` | Opens each post with a table of contents when it has two headings or more. A post's `toc` front matter overrides it. |
| `blog.feedFullContent` | `false` | Puts each post's whole body in the RSS feed instead of its summary. |
| `blog.taxonomies.category`, `blog.taxonomies.series` | `categories` or `tags`, `series` | The taxonomies behind the blog's Places and Series lenses and the post chips. Without `category`, the blog reads `categories`, or `tags` on a site that has tags and no categories. |
| `home.layout` | `terminal` | `page` renders the home's content in a plain window instead of the terminal. The Dash then lists the home page as Home, and the keyboard shortcuts dialog leaves out the terminal's keys. |
| `terminal.user`, `terminal.host` | `user`, host of `baseURL` | The guest login a visitor gets in the home terminal. |
| `projects.github` | | A GitHub account whose public repositories fill the projects page when the site has no `data/projects.yaml`. |
| `projects.minStars`, `projects.minForks`, `projects.recentMonths` | `100`, `6`, `6` | The thresholds behind the projects sidebar's Starred, Forks, and Recent filters. |
| `projects.exclude` | | Names of projects to leave out of the projects page and the Dash, whether they come from `data/projects.yaml` or `projects.github`. A list or one name. The match ignores case. |
| `projects.languages` | every language | The languages to keep, such as `["Go", "Rust"]`. A project in any other language, or without one, drops out. The match ignores case. |
| `projects.requireDescription` | `false` | `true` leaves out every project without a description. |
| `studio.playlist` | `assets/midi/*.mid` and `*.midi`, by file name | MIDI files under `assets/` that the Studio plays, in order. An entry is a path or a `{path, title}` table. A track without a title shows as "Track N". |

### Menu

`menu.main` drives the launcher dock, the Dash's Applications category, the File menu, and the panel's navigation actions. Home is implicit and always first. Point an entry at a page with `pageRef`, which follows the page's permalink and language, or at any other address with `url`. Per-entry `[menu.main.params]` accept `icon` (an SVG name under `assets/unity/icons/`, such as `launcher/cv`, which your site may add to), `match` (`"exact"` or `"prefix"`), `kw` (Dash keywords), `dashLabel`, `dashIcon`, and the `launcher` and `dash` booleans that keep a page off the dock or out of the Dash. `launcher = "running"` docks a page only while it is open. Known identifiers (`cv`, `blog`, `posts`, `projects`, `sponsors`, `icons`, `solitaire`, `about`) get fitting icons and keywords automatically.

A `url` with a scheme, such as `https:` or `mailto:`, passes through. Any other `url` resolves under your `baseURL` and the language's prefix, so on a site at `https://example.org/sub/`, `/files/` leads to `/sub/files/`. A `url` that already starts with the `baseURL`'s path, such as `/sub/files/`, stays as written. An entry whose `pageRef` finds no page in a language, and that sets no `url`, drops out of that language's desktop, and the build warns. List `unity-menu-unresolved` in `ignoreLogs` to silence that warning, for example on a multilingual site that leaves a page untranslated.

The launcher, the Dash, and the HUD show each `icon` as an image file that the browser caches across pages. Images cannot use the page's CSS or another file's ids, so every icon you add must draw everything it shows itself. Icons that paint with `currentColor` render inline instead, so they take the color of the text around them.

`menu.help` adds links to the end of the top panel's Help menu, ordered by weight. It suits pages that every page must reach but the dock should not hold, such as a privacy notice or an imprint. Its entries resolve `pageRef` and `url` the same way as `menu.main`, and the HUD finds them like any other menu row. An entry whose `pageRef` names no page in the current language stays out of that language's Help menu.

```toml
[[menu.help]]
  name    = "Privacy"
  pageRef = "/privacy"
```

## Content

- `content/posts/*.md` are blog posts. `categories` and `series` front matter feed the sidebar lenses, and on a site that has tags and no categories, `tags` takes the place of `categories`. `params.blog.taxonomies` points either lens at another taxonomy. The theme finds the blog section through Hugo's `mainSections`, so `content/blog/` works too. Posts may sit in nested sections such as `content/posts/2024/`, and each section's list shows the posts at any depth below it. A list shows every post and filters and sorts them in the browser, so Hugo's `pagination` settings do not apply. A site without sections has no blog, so its pages render as plain windows, and the keyboard shortcuts dialog leaves out the blog's keys.
- Pages without `title` front matter get a title from the theme. Posts take their date, and other pages take their file name in title case. The home page takes the site's `title`, then the host of `baseURL`.
- Any page accepts `noindex = true`, which asks search engines to skip it and keeps it out of the sitemap, and `slug`, which also names the page's file in the home terminal. `description` and `images` set the page's search and share metadata, and `canonicalURL` points its canonical link at the original of a syndicated post. Without `images`, a bundle image whose name contains `feature`, `cover`, or `thumbnail` is the share image. `imageAlt` gives the first share image its alt text. Share images from the page's bundle or from `assets/` declare their width and height. The theme shares each such JPEG, PNG, or WebP image that is wider than 1200 pixels as a copy 1200 pixels wide.
- `content/cv.md` with `layout = "cv"` is the PDF viewer. Front matter: `pdf` (required), `pdfPrintable`, `sourceUrl`. The viewer runs on Chrome 125, Safari 18, Firefox ESR, and later. Older browsers get a link to the PDF.
- `content/sponsors.md` with `layout = "sponsors"` renders cards from `data/sponsors.yaml`. Each entry has `name`, `url`, and an optional `avatar`. The "Become a sponsor" button points at `sponsorUrl` from the page's front matter, or else at GitHub Sponsors for your `github` social entry. A `url`, `avatar`, or `sponsorUrl` that is not a full address resolves to a file in the page's bundle, then a file under `assets/`, then a path under your `baseURL`.
- `content/projects.md` with `layout = "projects"` renders the grid from `data/projects.yaml`. See `exampleSite/data/projects.yaml` for the schema, in which only `name` is required. `updated` takes a date such as `2024-05-20`, and a value that is not a date warns and leaves the project without one. Without that file, set `params.projects.github` to your GitHub account, and the build fetches up to 100 of its public repositories with a language, skipping forks and archived ones. The `projects.exclude`, `projects.languages`, and `projects.requireDescription` params narrow the list from either source. Set the `HUGO_GITHUB_TOKEN` environment variable to lift the GitHub API's rate limit for anonymous requests. Hugo's cache serves the list for the rest of the day the build fetched it, so the first build of each day needs the network. When that request fails or takes more than 10 seconds, the build warns and the page shows no projects. Any language name works. The theme draws its own emblem for Go, Python, TypeScript, JavaScript, Rust, Shell, C, HTML, Ruby, and Lua, and a generic one for the rest. On a site without a page of that layout, the keyboard shortcuts dialog leaves out the grid's keys.
- `content/solitaire.md` with `layout = "solitaire"` is the solitaire table. The terminal's `solitaire` command opens the first page with that layout. On a site without such a page, the keyboard shortcuts dialog leaves out the table's keys.
- `content/icons.md` with `layout = "icons"` is the icon vault, a copy-to-clipboard catalogue of every SVG the theme ships.
- `assets/midi/*.mid` files are the Studio's playlist. The theme ships none, and a site without any gets no Studio, so its pages load a smaller script without the Studio's code.
- Any other top-level page renders in a plain window and appears in the terminal's filesystem, where `cat` prints its markdown.
- `content/_index.md` titles the home page, and its body becomes `~/README.md` in the terminal. Without a body, the terminal writes its own welcome there.

`hugo new posts/my-post.md` uses the theme's `archetypes/posts.md`. For a blog section with another name, copy that file to `archetypes/<section>.md` in your site.

### Markdown

The theme's render hooks extend Hugo's Markdown:

- **Links and images.** A relative link or image resolves to a page, then a file in the page's bundle, then a file under `assets/`, so `[intro](other-post.md)` and `![](photo.jpg)` beside an `index.md` both work. A root-relative path that matches none of them, such as `/files/cv.pdf`, resolves under your `baseURL`, so it keeps working on a site served from a subdirectory. Images Hugo can read get a width and height. Browsers load a WebP copy of each JPEG or PNG image when WebP makes it smaller, and Hugo encodes the copies with your site's [`[imaging.webp]` settings](https://gohugo.io/configuration/imaging/#webp). Feeds get absolute URLs and the original images, and an alert becomes a plain blockquote led by its title.
- **Headings.** Every heading ends with a `#` link to itself, which shows on hover. Feeds get the plain heading.
- **Alerts.** GitHub-style alerts render as info bars. The types are `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`, text after the marker replaces the title, and a `+` or `-` after the type makes the alert collapsible, open or closed:

  ```markdown
  > [!WARNING]- Read this first
  > The alert starts collapsed.
  ```

- **Math.** On a site that merges the theme's `markup` (see [Site settings](#site-settings)), TeX between `\(` and `\)` renders inline, and TeX between `\[` and `\]` or between `$$` and `$$` renders as a block. The build renders it to MathML, so math does not need a script or stylesheet.

## Customizing

- **Extra CSS.** Add `assets/css/custom.css` to your site. The theme keeps its own rules in cascade layers and builds yours in after them with no layer, so your rules beat the theme's whatever their specificity. Theme declarations marked `!important` still win. Your file goes through the same `css.Build` pass as the theme's stylesheet, so it can use native nesting and `@import` other files. A bare path such as `@import "fonts.css"` resolves beside `custom.css` in your site's `assets/css/` first, then from `assets/`. An `@import url(...)` of an external stylesheet, such as a web font's, lands at the top of the built stylesheet, where browsers load it. Every theme selector is prefixed `up-`, and every custom property is prefixed `--up-`.
- **Colors and fonts.** Custom properties on `:root` hold the theme's colors and font stacks. Set one in `custom.css` to change everything it paints. Leave the theme's other custom properties alone, because they are internal.

  | Property | Default | Paints |
  | --- | --- | --- |
  | `--up-wallpaper` | The aubergine gradient, or the image that `params.desktop.wallpaper` names | The desktop and the lock screen. It takes any `background` value. |
  | `--up-panel-grad-1`, `--up-panel-grad-2` | `#3F3D3A`, `#252423` | The top panel, as a gradient from top to bottom. |
  | `--up-chrome-1`, `--up-chrome-2` | `#3F3D3A`, `#2A2825` | The titlebar of the focused window and of every dialog, as a gradient. |
  | `--up-chrome-inactive-1`, `--up-chrome-inactive-2` | `#4D4A47`, `#3B3835` | The titlebar of an unfocused window, as a gradient. |
  | `--up-content-bg` | `#F6F5F4` | The body of each window. |
  | `--up-content-fg` | `#2E2B28` | Text in windows and dialogs. |
  | `--up-content-muted` | `#6B6764` | Secondary text, such as dates, counts, and hints. |
  | `--up-content-line` | `#D8D5D2` | Borders and rules in windows. |
  | `--up-link` | `#2B4E8E` | Links in posts, pages, and dialogs. |
  | `--up-sidebar-bg` | A light gray gradient | The sidebar of the blog and of the CV viewer. It takes any `background` value. |
  | `--up-terminal-bg` | `#1F0E1A` | The home terminal's translucent backdrop. |
  | `--up-font-sans` | Ubuntu, then the system's sans-serif font | The desktop's text. |
  | `--up-font-mono` | Ubuntu Mono, then the system's monospace font | The terminal, code, and other monospaced text, the Studio's piano roll included. |

  The build resolves each `url()` in `custom.css` the way it resolves an `@import` and publishes the file, so keep a wallpaper image under your site's `assets/`, such as beside `custom.css`. Load a web font with an `@font-face` rule or an `@import url(...)` in the same file. The theme preloads its regular Ubuntu faces whatever the font properties hold.

  ```css
  :root{
    --up-wallpaper:url("wallpaper.jpg") center/cover;
    --up-font-sans:"Fira Sans",system-ui,sans-serif;
    --up-font-mono:"Fira Mono",ui-monospace,monospace;
  }
  ```

  The top panel and the home terminal declare `color-scheme: dark`, so the browser draws their scrollbars and form controls dark. If your site paints either one light, set `color-scheme: light` on `.up-top-panel` or `.up-neofetch` in `custom.css`.
- **Accent colors.** The accent paints highlights, such as selected text, menu rows under the pointer, primary buttons, progress bars, and focus rings. Edit > Preferences offers a swatch for each preset under `params.desktop.accents`, and `params.desktop.accent` names the preset each page starts with. The theme defines `orange`, `green`, `aubergine`, and `blue`. Your site adds a preset with a table of its own and removes one by setting it to `false`:

  ```toml
  [params.desktop]
    accent = "brand"
    accents.green = false

  [params.desktop.accents.brand]
    color  = "#0E8420"
    label  = "Brand"
    weight = 5
  ```

  | Key | Default | Purpose |
  | --- | --- | --- |
  | `color` | | The accent. A preset without one warns and drops out. |
  | `light` | `color` mixed with 15% white | A lighter shade, for the swatch, hover states, and the top of each highlight gradient. |
  | `lighter` | `color` mixed with 60% white | The lightest shade, for accent text, marks, and focus rings on the dark surfaces, such as the top panel's menus and the titlebars. |
  | `dark`, `darker` | `color` mixed with 20% and 36% black | Darker shades, for the bottom of each gradient, pressed buttons, and borders. |
  | `label` | The translated `accent_<name>` string for the theme's presets, and the name for yours | The swatch's tooltip and its name for screen readers. |
  | `weight` | | The swatch order, lowest first. Presets without a weight follow, by name. The theme's presets weigh 10, 20, 30, and 40. |

  Focus rings on the light window surfaces paint `color`, so give it a contrast of 4:1 or more with white. White text and the focus ring of a selected row sit on `light`, so give it 3:1 or more. When a visitor's system asks for more contrast, that white text sits on `dark` or `darker` instead, so give both a contrast of 4.5:1 or more with white. Accent text in the top panel's menus paints `lighter`, so give it a contrast of 4.5:1 or more with `#2A2825`, the lightest color of the menus' background. Give it 3:1 or more with `#4D4A47`, the lightest color of a titlebar, because focus rings and icons on the dark surfaces paint it too. The default `lighter` keeps both for every `color`.

  Hugo merges your presets into the theme's key by key, so a built-in preset whose `color` your site changes keeps the theme's other shades. Add a preset of your own instead. Do not set `--up-accent` or its shades in `custom.css`, because a value there beats every preset, and Edit > Preferences stops changing it.
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
- **Content Security Policy.** The theme renders no inline script, event handler, style element, or style attribute, so its pages work under `script-src 'self'` and `style-src 'self'`, with or without JavaScript. When JavaScript runs, the home terminal needs `style-src 'unsafe-inline'`, because xterm.js adds style elements at runtime. Hugo's Google Analytics tag is an inline script. Hugo's default syntax highlighting writes style attributes. A site that merges the theme's `markup` (see [Site settings](#site-settings)) highlights code with classes instead, and the theme's stylesheet carries the classes for your `markup.highlight.style`. The theme's `youtube` shortcode replaces Hugo's, takes the same arguments and `privacy.youtube` settings, and sizes the player from the stylesheet instead of style attributes. Hugo's `vimeo` shortcode writes style attributes unless you give it a `class`, and its `instagram` shortcode always does.
- **Analytics.** Set `services.googleAnalytics.id` and production builds include Hugo's Google Analytics tag. For any other provider, use `extend-head.html`.
- **Translations.** Copy `i18n/en.toml` to `i18n/<lang>.toml` in your site, translate the values, and put each placeholder such as `{{ .Tag }}` where your language needs it. That covers the desktop's dialogs and notifications too, whose keys start with `js_` and use `{name}` placeholders instead of Go templates. The `kw_` keys hold the words the Dash search matches, so a translation can add words in its own language. A key your file leaves out shows the theme's English, whatever your default language, and the build warns once per language with the keys your file lacks. List `unity-i18n-missing` in `ignoreLogs` to silence that warning. The home terminal stays in English, like the bash it imitates.
- **Languages.** On a multilingual site, a language badge joins the top panel's indicators. Its menu lists every language and leads to the current page's translation, or to that language's home page when the page has none. On a site that gives each language its own `baseURL`, each row leads to its language's host. The badge shows the first two letters of the language's name, and `[languages.<lang>.params.desktop] languageBadge` replaces them, so `pt` and `pt-br` can read `Pt` and `Br`. Set `[languages.<lang>] direction = "rtl"` for a right-to-left language. The home terminal and the Studio stay left to right, because a shell and a piano roll read left to right in every language.
- **Panel indicators.** Add `layouts/_partials/unity/indicators/<name>.html` to your site and list `<name>` in `params.desktop.indicators`. The panel is the same on every page, so the theme renders each indicator once per language, with the site as its context. Copy one of the theme's indicators for the markup: a `.up-panel-item` that holds a `.up-indicator` button with `data-panel-trigger`, `data-indicator="<key>"`, and `aria-controls="up-dropdown-<key>"`, and a `.up-dropdown` with `id="up-dropdown-<key>"` and `data-dropdown-for="<key>"`. The button follows the ARIA disclosure pattern, so it does not set `aria-haspopup`. The panel then opens and closes the dropdown, the HUD searches its `.up-dropdown-row` links, and the arrow keys, Home, and End move through its links and buttons. A name with no partial renders nothing and makes the build warn.
- **Favicons.** Drop `favicon.svg`, `favicon.ico`, and `apple-touch-icon.png` into your site's `static/` to replace the theme's.
- **Terminal ascii art.** Override `assets/unity/home/ascii.txt` (the art) and `assets/unity/home/colors.txt` (a same-shape color mask using `O Y G B P C R M`, with space for no color).
- **Terminal login.** The prompt reads `user@<host of baseURL>`, and so does the terminal's window title, which ends in the working directory, such as `: ~`, or `: ~/posts` after `cd posts`. A `title` in `content/_index.md` replaces the window title, and a `cd` then leaves it unchanged. Set `params.terminal.user` and `params.terminal.host` to change either half of the login.
- **Language emblems.** Copy the theme's `assets/unity/icons/glyphs/lang-symbols.svg` to the same path in your site and add a `<symbol id="lang-<Name>">` to give a project language its own emblem. Your copy replaces the theme's whole sprite, so start from the theme's file.
- **Page layouts.** A layout of your own can render one of the theme's pages through its partial under `layouts/_partials/unity/page/`, and the page still loads that partial's script. For example, `layouts/portfolio.html` holding `{{ define "main" }}{{ partial "unity/page/projects.html" . }}{{ end }}` renders the projects grid on every page with `layout = "portfolio"`. The keyboard shortcuts dialog finds the projects grid and the solitaire table only by the theme's `layout` names. It leaves out their keys on a site that renders them only under layouts of its own.
- **Anything else.** Copy a file from the theme's `layouts/` into your site's `layouts/` at the same path and edit it. The theme keeps its partials under `layouts/_partials/unity/`, so your site's own partials, such as `_partials/head.html` or `_partials/author.html`, never replace them. To override one, copy it to `layouts/_partials/unity/<path>` in your site. The `extend-*` hooks stay at the top of `layouts/_partials/`, because they are yours to add. The theme keeps its own assets under `assets/unity/`, so your site's `assets/css/`, `assets/js/`, and `assets/icons/` never replace them, and a copy under `assets/unity/` overrides the theme's file at that path. Keep the theme's `data-*` attributes and `up-` classes in your copy, because scripts find elements such as the panel's battery and volume glyphs by them.

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
npm run test:browser     # playwright: every example page in Chromium
```

The dev tooling needs Node 22.18 or later, the first Node 22 release that runs the TypeScript under `scripts/` without a flag.

The browser suite serves the example site with the Content Security Policy under [Customizing](#customizing) and fails on any script error or blocked inline style. It runs Chromium through Playwright, so download the browser once with `npx playwright install chromium`.

The theme vendors xterm.js and pdf.js under `assets/unity/third_party/`, so sites build without npm. To upgrade either, edit the version in `scripts/vendor-xterm.ts` or `scripts/vendor-pdfjs.ts` and run `npm run vendor:xterm` or `npm run vendor:pdfjs`.

The `js_` keys in `i18n/en.toml` hold the strings that the scripts show, and `assets/unity/js/i18n-keys.ts` types them for tsc. After adding, renaming, or removing a `js_` key or a placeholder, run `npm run i18n:types` to regenerate that file.

The bash-conformance suite skips itself where bash is absent. The suite that checks Hugo's output against the scripts' types builds the example site and a bare site. It skips itself where Hugo is absent.

## License

Apache-2.0. See [LICENSE.md](https://github.com/MacroPower/macropower.github.io/blob/main/themes/unity/LICENSE.md).

- [Ubuntu font family](https://design.ubuntu.com/font) 0.83 ([Ubuntu Font Licence 1.0](https://ubuntu.com/legal/font-licence)), self-hosted subsets under `assets/unity/fonts/`. The licence text is in `LICENCE.txt` and Canonical's copyright notice is in `copyright.txt` in the same directory.
- [xterm.js](https://xtermjs.org/) 6.0.0 (MIT), vendored under `assets/unity/third_party/xterm/`.
- [pdf.js](https://mozilla.github.io/pdf.js/) 6.4.299 legacy build (Apache-2.0), vendored under `assets/unity/third_party/pdf-js/`.
- Ubuntu and Unity are trademarks of Canonical Ltd. This theme is a fan recreation and is not affiliated with or endorsed by Canonical.
