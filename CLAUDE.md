# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hugo static site for jacobcolvin.com, deployed to GitHub Pages from `main`. The Hugo version is pinned in two places that must be kept in sync: `devbox.json` (local dev) and `.github/workflows/gh-pages.yml` (`peaceiris/actions-hugo` step). When upgrading, bump both. Dart Sass is pinned the same way in `devbox.json` and the `Install Dart Sass` step in `.github/workflows/gh-pages.yml`. Keep both in sync when upgrading.

## Commands

- `devbox shell` — enter a shell with the pinned Hugo on PATH.
- `hugo server -D` — local dev server with drafts enabled; live-reloads on changes.
- `hugo --minify` — production build into `public/` (the same command CI runs).
- `npm test` / `npm run test:watch` — Vitest suites under `themes/ubuntu-unity/assets/js/**/*.test.ts`: the terminal shell core's unit + bash-conformance tests, the MIDI parser/tempo-warp suite (`midi.test.ts`), and the solitaire rules and solver suites (`solitaire/klondike.test.ts`, `solitaire/solver.test.ts`). CI runs both the tests and both typecheck passes (after `npm ci`, before the Hugo build); the conformance suite auto-skips when `bash` is absent. `npm run typecheck` covers the production bundle and `npm run typecheck:test` covers the test sources. The tsconfigs and vitest config live inside the theme (the root npm scripts delegate to them), so the same suites run from a standalone theme checkout.
- The only theme is `themes/ubuntu-unity/` — in-tree, but written as a standalone reusable theme (own README, exampleSite, package.json); there are no git submodules. Run its example site with `hugo server -s exampleSite --themesDir ../..` from the theme directory.

## Architecture

- `hugo.toml` is the single source of truth for site config: `theme = "ubuntu-unity"` selects which directory under `themes/` is used, `[params.social]` drives the terminal banner links and social metadata. `[menu.main]` drives the theme's site-pages registry — the launcher dock, the Dash's Applications category, the top panel's File menu, and the `nav:<key>` actions — with per-entry `[menu.main.params]` (`icon`, `match`, `kw`, `dashLabel`, `dashIcon`, `launcher`, `dash`; see the theme's `_partials/site-pages.html`). Solitaire is an easter egg: `launcher = "running"` docks it only while open and keeps it off the File menu, and its front matter sets `noindex` and disables the sitemap entry, so it is reached through the Dash or the terminal's `solitaire` command. Add new top-level pages by adding both a menu entry here and a matching markdown file under `content/`.
- `content/posts/*.md` are blog posts; `mainSections = ["posts"]` in `hugo.toml` tells the theme which section is the blog. Front matter is TOML (`+++`-delimited) with `categories`, `date`, `type`, `series`, `title`, `slug`, `description`, plus optional `tags`. Permalink shape is `/posts/:year/:month/:title/` (see `[permalinks]` in `hugo.toml`) — changing titles or dates breaks existing URLs; `slug` does not affect URLs (Hugo's `:title` token ignores it) and only names the post's file in the home terminal's VFS.
- There is no top-level `layouts/` directory anymore — every template lives in the theme. Hugo's lookup order still applies: to customize a theme template, copy it from `themes/ubuntu-unity/layouts/...` into a new top-level `layouts/...` at the same path and edit the copy. The same union-mount trick overrides theme assets (e.g. the terminal's ascii art at `assets/home/ascii.txt`).
- `static/` is copied verbatim to the site root at build time. `static/CNAME` is what pins the custom domain on GitHub Pages; the favicon set, the Open Graph card (`img/og-card.png`), and the CV PDFs (`files/`) live here too. The Ubuntu fonts and vendored pdf.js ship inside the theme's own `static/`.
- Bespoke pages are selected by `layout` front matter, not filename: `content/cv.md` sets `layout = "cv"` (Evince-style PDF viewer; `pdf`, `pdfPrintable`, `sourceUrl` params), `content/sponsors.md` sets `layout = "sponsors"` (cards from `data/sponsors.yaml`), `content/solitaire.md` sets `layout = "solitaire"` (the pixel-art Klondike table from the theme's `assets/js/solitaire/`; its markdown body is only what the home terminal prints for `cat solitaire.md`), `content/icons.md` sets `layout = "icons"`.
- `public/` and `resources/` are build outputs and are gitignored — never commit them and never hand-edit them.

## Deployment

`gh-pages.yml` builds on every push/PR and deploys to the `gh-pages` branch only on pushes to `main` (using `peaceiris/actions-gh-pages`). PRs build but do not publish. There is no preview environment — to validate changes, run `hugo server` locally.

The home page's interactive terminal depends on `@xterm/xterm` (+ `addon-fit`, `addon-web-links`), declared in the root `package.json` (mirroring the theme's `package.hugo.json`) and bundled by Hugo's esbuild from `node_modules`. CI installs them with an `actions/setup-node` + `npm ci` step before `hugo --minify`; `node-version` is pinned to match `devbox.json` (`nodejs@22`). `package-lock.json` must be committed and in sync with `package.json` — `setup-node`'s `cache: npm` keys off the lockfile and `npm ci` hard-fails if it drifts. Locally, run `npm install` after editing `package.json` (the devbox `init_hook` only installs when `node_modules` is absent). If the xterm versions change, bump them in both the root `package.json` and the theme's `package.json`/`package.hugo.json`.
