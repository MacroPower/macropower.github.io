# ubuntu-unity

A personal-site Hugo theme styled after the Ubuntu 14.04 Unity desktop:
top panel with working indicator menus, vertical launcher dock, your
pages inside a draggable desktop window — and an interactive terminal as
the home page.

**Demo:** [jacobcolvin.com](https://jacobcolvin.com) (the theme's origin site)
or run the bundled [example site](#example-site).

## Features

- **Interactive home terminal** — a real shell (xterm.js) with a bash-like
  parser (pipes, redirections, globbing, `$(...)`, arithmetic), a writable
  virtual filesystem seeded from your site's content, ~60 commands, tab
  completion, history, and a neofetch banner built from your site params.
  The shell core is renderer-agnostic and covered by a differential test
  suite that asserts agreement with real bash.
- **Unity desktop chrome** — top panel (File/Edit/View/Help menus, inbox,
  network, sound, battery, clock indicators), launcher dock, Dash search
  overlay (Super), HUD menu search (Alt), lock screen, NotifyOSD bubbles,
  and a session-only trash window.
- **Blog** — Nautilus-style post list with filtering, sorting, and search;
  category and series lenses; a focused post reader; posts-only RSS.
- **Projects page** — an icon-grid "file manager" over a simple YAML data
  file, with drag-to-reorder, rubber-band selection, and a preview pane.
- **CV page** — an Evince-style PDF document viewer (vendored pdf.js) with
  thumbnails, zoom, and print/source actions from front matter.
- **Solitaire page** -- Klondike in a Balatro-style pixel-art table:
  a low-resolution canvas upscaled with nearest-neighbor sampling, a
  bitmap font, synthesized sound effects, drag or click-to-move, draw
  one or three, undo, hints, auto-complete, and the bouncing-card
  finish. Rules are a tested, DOM-free module.
- **Sponsors page**, hidden icon-vault page, spotify shortcode, Open
  Graph/Twitter/JSON-LD metadata, self-hosted Ubuntu fonts, and a
  MIDI-playing synth "Studio" easter egg behind the sound indicator.

Everything is server-rendered by Hugo partials; TypeScript modules
(bundled by Hugo's esbuild, no separate build step) enhance the DOM.
All desktop state is session-only by design — a reload gives you a
fresh desktop.

## Requirements

- Hugo **extended** ≥ 0.161.0, with [Dart Sass](https://gohugo.io/functions/css/sass/#dart-sass)
  on PATH (the CSS pipeline uses the `dartsass` transpiler)
- Node.js + npm (the home terminal bundles xterm.js from `node_modules`)

## Installation

The theme lives in the `themes/ubuntu-unity` directory of the
[macropower.github.io](https://github.com/MacroPower/macropower.github.io)
repository and carries its own `go.mod`, so Hugo modules can import it
from there.

### As a Hugo module

```bash
hugo mod init github.com/you/yoursite
```

```toml
# hugo.toml
[module]
  [[module.imports]]
    path = "github.com/MacroPower/macropower.github.io/themes/ubuntu-unity"
```

Then pull the theme's npm dependencies into your site and install them:

```bash
hugo mod npm pack
npm install
```

Hugo's esbuild resolves the xterm packages from your site's
`node_modules`; the theme's own directory is not on its search path.

### As a copy under themes/

```bash
git clone --depth 1 https://github.com/MacroPower/macropower.github.io /tmp/mp
cp -r /tmp/mp/themes/ubuntu-unity themes/ubuntu-unity
echo 'theme = "ubuntu-unity"' >> hugo.toml
```

Copy the `dependencies` block from the theme's `package.hugo.json` into
your site's `package.json` (or start from the example site's setup) and
run `npm install`.

## Configuration

Start from `exampleSite/hugo.toml` — it documents every option. The
short version:

```toml
baseURL = "https://example.org/"
title   = "Jane Doe"
theme   = "ubuntu-unity"

[taxonomies]
  category = "categories"
  series   = "series"

[params]
  description  = "Jane Doe's personal site."
  homeSubtitle = "Software Engineer"   # terminal banner "title" row
  homeFocus    = "Distributed Systems" # focus line under it

  [params.author]
    name  = "Jane Doe"
    email = "jane@example.org"
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

`menu.main` drives the whole desktop: the launcher dock, the Dash's
Applications category, the top panel's File menu, and the panel's
navigation actions. Home is implicit and always first. Per-entry
`[menu.main.params]`: `icon` (launcher artwork under the theme's
`assets/icons/`), `match` (`"exact"`/`"prefix"` active-state URL
matching), `kw` (Dash search keywords), `dashLabel`/`dashIcon`
overrides, and `launcher`/`dash` booleans to keep a page off the dock
or out of the Dash. `launcher = "running"` docks a page only while it
is open, like the Studio's running-app tile, and keeps it off the File
menu; the Dash still finds it. Known identifiers (`cv`, `blog`, `posts`,
`projects`, `sponsors`, `icons`, `solitaire`, `about`) get fitting
icons and keywords automatically.

### Content

- `content/posts/*.md` — blog posts; `categories` and `series` front
  matter feed the sidebar lenses. The theme finds the blog section
  through Hugo's `mainSections` (by default the section with the most
  pages), so `content/blog/` works too; set `mainSections = ["blog"]`
  when another section outgrows it.
- `content/cv.md` with `layout = "cv"` — the PDF viewer; front matter:
  `pdf` (required), `pdfPrintable`, `sourceUrl`.
- `content/sponsors.md` with `layout = "sponsors"` — cards from
  `data/sponsors.yaml` (`name` required; `url`, `avatar` optional).
- `content/projects.md` with `layout = "projects"` — the projects grid,
  from `data/projects.yaml` (see `exampleSite/data/projects.yaml` for
  the schema); the markdown body only shows in the home terminal.
- `content/solitaire.md` with `layout = "solitaire"` -- the solitaire
  table; the markdown body only shows in the home terminal (`cat
  solitaire.md`), and the terminal's `solitaire` command opens the page.
  The example site hides it as an easter egg (`launcher = "running"`,
  `noindex`, sitemap disabled).
- `content/icons.md` with `layout = "icons"` — the hidden icon vault.
- Any other top-level page renders in a plain window — and appears in
  the home terminal's filesystem, where `cat` prints its markdown.

The theme ships defaults for `params.dateform`, `params.dateformNum`,
and `params.enableReadingTime`; a site's own values win.

`hugo new posts/my-post.md` uses the theme's `archetypes/posts.md`
(title, date, description, categories, series); every other path gets
`archetypes/default.md`.

### Customizing

- **Favicons** — the theme ships a terminal-prompt `favicon.svg`,
  `favicon.ico`, and `apple-touch-icon.png`; drop files with the same
  names into your site's `static/` to replace them.
- **Terminal ascii art** — override `assets/home/ascii.txt` (the art)
  and `assets/home/colors.txt` (a same-shape color mask: `O Y G B P C
  R M`, space = no color) in your site.
- **Anything else** — standard Hugo: copy a file from the theme's
  `layouts/` into your site's `layouts/` at the same path and edit it.

## Example site

```bash
cd themes/ubuntu-unity
npm install
hugo server -s exampleSite --themesDir ../..
```

## Development

The TypeScript sources live under `assets/js/` and are type-checked and
tested from the theme directory:

```bash
npm install
npm run typecheck        # production sources
npm run typecheck:test   # test sources
npm test                 # vitest: shell core, bash conformance, MIDI parser
```

The bash-conformance suite runs the same programs through the shell core
and real bash and asserts they agree; it auto-skips where bash is absent.

## Credits & license

MIT — see [LICENSE.md](LICENSE.md).

- [Ubuntu font family](https://design.ubuntu.com/font) (self-hosted subsets,
  [Ubuntu font licence](https://ubuntu.com/legal/font-licence))
- [xterm.js](https://xtermjs.org/) (MIT)
- [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0, vendored under
  `static/js/pdf-js/`)
- Ubuntu and Unity are trademarks of Canonical Ltd. This theme is a fan
  recreation and is not affiliated with or endorsed by Canonical.
