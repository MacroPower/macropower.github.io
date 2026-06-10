# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hugo static site for jacobcolvin.com, deployed to GitHub Pages from `main`. The Hugo version is pinned in two places that must be kept in sync: `devbox.json` (local dev) and `.github/workflows/gh-pages.yml` (`peaceiris/actions-hugo` step). When upgrading, bump both. Dart Sass is pinned the same way in `devbox.json` and the `Install Dart Sass` step in `.github/workflows/gh-pages.yml`. Keep both in sync when upgrading.

## Commands

- `devbox shell` — enter a shell with the pinned Hugo on PATH.
- `hugo server -D` — local dev server with drafts enabled; live-reloads on changes.
- `hugo --minify` — production build into `public/` (the same command CI runs).
- `npm test` / `npm run test:watch` — Vitest suites under `themes/ubuntu-unity/assets/js/**/*.test.ts`: the terminal shell core's unit + bash-conformance tests plus the MIDI parser/tempo-warp suite (`midi.test.ts`). CI runs both the tests and both typecheck passes (after `npm ci`, before the Hugo build); the conformance suite auto-skips when `bash` is absent. `npm run typecheck` covers the production bundle and `npm run typecheck:test` covers the test sources.
- The only theme is `themes/ubuntu-unity/` — an in-tree fork; there are no git submodules.

## Architecture

- `hugo.toml` is the single source of truth for site config: `theme = "ubuntu-unity"` selects which directory under `themes/` is used, `[menu.main]` drives the nav, `[params.social]` drives the footer icons. Add new top-level pages by adding both a menu entry here and a matching markdown file under `content/`.
- `content/posts/*.md` are blog posts. Front matter is TOML (`+++`-delimited) with `categories`, `date`, `type`, `series`, `title`, `slug`, `description`, plus optional `tags`. Permalink shape is `/posts/:year/:month/:title/` (see `[permalinks]` in `hugo.toml`) — changing slugs or dates breaks existing URLs.
- Hugo's lookup order means files in the top-level `layouts/` override the theme's `themes/ubuntu-unity/layouts/`. Today the local `layouts/` is mostly empty except for two custom shortcodes (`shortcodes/embed-pdf.html`, `shortcodes/spotify.html`) — anything else you add there shadows the theme. To customize a theme template, copy it from `themes/ubuntu-unity/layouts/...` into `layouts/...` at the same path and edit the copy.
- `static/` is copied verbatim to the site root at build time. `static/CNAME` is what pins the custom domain on GitHub Pages; the favicon set, the Open Graph card (`img/og-card.png`), the CV PDFs (`files/`), and the vendored pdf.js (`js/pdf-js/`) live here too.
- `public/` and `resources/` are build outputs and are gitignored — never commit them and never hand-edit them.

## Deployment

`gh-pages.yml` builds on every push/PR and deploys to the `gh-pages` branch only on pushes to `main` (using `peaceiris/actions-gh-pages`). PRs build but do not publish. There is no preview environment — to validate changes, run `hugo server` locally.

The home page's interactive terminal depends on `@xterm/xterm` (+ `addon-fit`, `addon-web-links`), declared in `package.json` and bundled by Hugo's esbuild from `node_modules`. CI installs them with an `actions/setup-node` + `npm ci` step before `hugo --minify`; `node-version` is pinned to match `devbox.json` (`nodejs@22`). `package-lock.json` must be committed and in sync with `package.json` — `setup-node`'s `cache: npm` keys off the lockfile and `npm ci` hard-fails if it drifts. Locally, run `npm install` after editing `package.json` (the devbox `init_hook` only installs when `node_modules` is absent).
