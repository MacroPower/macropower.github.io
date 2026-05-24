# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Hugo static site for jacobcolvin.com, deployed to GitHub Pages from `main`. The Hugo version is pinned with Devbox (`devbox.json`, currently `hugo@0.161.1`); the GitHub Actions workflow at `.github/workflows/gh-pages.yml` pins its own Hugo version (`peaceiris/actions-hugo`) which can drift from the Devbox pin — bump both together when upgrading.

## Commands

- `devbox shell` — enter a shell with the pinned Hugo on PATH.
- `hugo server -D` — local dev server with drafts enabled; live-reloads on changes.
- `hugo --minify` — production build into `public/` (the same command CI runs).
- `git submodule update --remote` — refresh theme content (per README), even though there is no `.gitmodules` today; `themes/ubuntu-unity` and `themes/hello-friend-ng` are stored as regular tracked directories that point back at this same repo as `origin`. Treat them as in-tree forks unless/until a real submodule is wired up.

## Architecture

- `config.toml` is the single source of truth for site config: `theme = "ubuntu-unity"` selects which directory under `themes/` is used, `[menu.main]` drives the nav, `[params.social]` drives the footer icons. Add new top-level pages by adding both a menu entry here and a matching markdown file under `content/`.
- `content/posts/*.md` are blog posts. Front matter is TOML (`+++`-delimited) with `categories`, `date`, `type`, `series`, `title`, `slug`, `description`, plus optional `tags`. Permalink shape is `/posts/:year/:month/:title/` (see `[permalinks]` in `config.toml`) — changing slugs or dates breaks existing URLs.
- Hugo's lookup order means files in the top-level `layouts/` override the theme's `themes/ubuntu-unity/layouts/`. Today the local `layouts/` is mostly empty except for two custom shortcodes (`shortcodes/embed-pdf.html`, `shortcodes/spotify.html`) — anything else you add there shadows the theme. To customize a theme template, copy it from `themes/ubuntu-unity/layouts/...` into `layouts/...` at the same path and edit the copy.
- `static/` is copied verbatim to the site root at build time. `static/CNAME` is what pins the custom domain on GitHub Pages, `static/overlay.css` is the site-wide CSS overlay layered on top of the theme, and `static/FiraCode-VariableFont_wght.ttf` is the self-hosted font referenced by it.
- `public/` and `resources/` are build outputs and are gitignored — never commit them and never hand-edit them.

## Deployment

`gh-pages.yml` builds on every push/PR and deploys to the `gh-pages` branch only on pushes to `main` (using `peaceiris/actions-gh-pages`). PRs build but do not publish. There is no preview environment — to validate changes, run `hugo server` locally.
