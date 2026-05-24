# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Hugo theme that styles a personal site as the Ubuntu 14.04 Unity desktop: top panel, vertical launcher dock, a single "window" containing the page content, and a trash icon — all interactive. There is no build step inside this directory; Hugo Pipes (`resources.Get | js.Build | resources.Fingerprint`) compiles `assets/` at site-build time from `baseof.html` and `head.html`.

## Anatomy

- `assets/css/main.css` (~900 lines) — every Unity-styled selector lives here, all prefixed `up-` (Ubuntu/Unity). One file by design; do not split it.
- `assets/js/app.jsx` — entry point. Hugo's esbuild compiles it to `js/app.js` with the shims under `assets/js/shims/` rewriting `react`, `react-dom`, and `react-dom/client` imports to read from the UMD globals (`window.React`, `window.ReactDOM`) that `baseof.html` loads via `<script>` tags from unpkg. React is never bundled.
- `assets/js/blog.js` — plain ES5 IIFE, not JSX. Drives the post list's filter/sort/search and the focused single-post reader. Lives outside the React tree because it manipulates server-rendered DOM directly (`data-up-post-row`, `data-up-search-*`, etc.).
- `assets/js/focus.js` — tiny pub/sub for whether the trash window currently has focus. Both `page-window.js` and `trash.jsx` read it so only one window looks focused at a time.
- `assets/js/page-window.js` — non-React module that wires the page window's titlebar buttons (close/min/max), drag-to-move spring, and launcher-tile state. Communicates outward via the `WINDOW_STATE_EVENT` custom event on `window`.
- `assets/js/{dialogs,top-panel,trash,window-chrome}.jsx` — independent React roots, each mounted by its own `mount*()` call from `app.jsx` into a host element produced by the matching partial in `layouts/partials/`.

## Layout contracts

- `layouts/_default/baseof.html` is the only base template. It renders the chrome partials (`top-panel`, `launcher`, `window-frame-open`, `{{ block "main" }}`, `window-frame-close`, `dialog-host`, `trash-window`) in that order. The `window-frame-open`/`window-frame-close` pair sandwich the content — `window-frame-open.html` opens `<div.up-window-stage> > <section.up-window-chrome data-page-window> > <div.up-titlebar> + <div.up-window-body>`, and `window-frame-close.html` closes them. Any layout's `{{ define "main" }}` body must emit inner content only; no extra outer wrapper, no overriding the titlebar.
- `layouts/_default/single.html` checks `.File.BaseFileName` against a `{"about","cv","contact"}` allowlist and dispatches to `partials/page/<name>.html` for those three pages; everything else falls through to a generic `<article.up-page>` wrapper. To add a bespoke top-level page (e.g. `now.md`), add `now` to the allowlist and create `partials/page/now.html`.
- `layouts/posts/{list,single}.html` are the blog index and post pages. They share `partials/page/post-pathbar.html` (the Nautilus-style breadcrumb), `post-list.html`, `post-reader.html`, `post-sidebar.html`, and `post-list-empty-reader.html`.

## DOM contracts JS depends on

`page-window.js` and `blog.js` query specific attributes that the Hugo templates must continue to emit:

- `[data-page-window]` — the window chrome element. Selected by `installPageWindow()`.
- `[data-titlebar]`, `.up-tl-close`, `.up-tl-min`, `.up-tl-max` — titlebar and traffic-light buttons inside the window.
- `.up-launcher-tile[data-page-current]` (current page) and `.up-launcher-tile.is-active:not([data-launcher-trash])` (active fallback) — the launcher tile that mirrors window state.
- `[data-blog-kind]` — root for `blog.js`; on absence, the script no-ops and returns immediately.
- `[data-up-post-list]`, `[data-up-post-list-body]`, `[data-up-post-row]`, `[data-up-post-empty]`, `[data-up-search-toggle]`, `[data-up-search-bar]`, `[data-up-search-input]`, `[data-up-search-count]`, `[data-up-search-close]`, `[data-up-sort]` — the filter/sort/search surface.

Rename any of these and the corresponding JS module silently stops working — there is no type system to catch it.

## Site-provided globals

`baseof.html` injects `window.UP_SITE = { handle, github, rss }` from `Site.Params.author.name`, `Site.Params.social[name=github]`, and the RSS output format before the JS bundles load. Components that need site identity (e.g. the top-panel session menu) read from `window.UP_SITE` rather than re-deriving from the DOM.

## Editing notes

- React/ReactDOM are loaded from unpkg pinned at `18.3.1`. Bumping the React version means editing `baseof.html` in two places. The site degrades gracefully if React fails to load — `app.jsx` `console.warn`s and skips mounting; the server-rendered HTML still works.
- `hugo.IsProduction` controls esbuild minification of the JSX bundle; the CSS path always minifies via `resources.Minify`. SRI integrity attributes are emitted for every fingerprinted asset.
- Fonts are split: Ubuntu / Ubuntu Mono come from Google Fonts (preconnected in `head.html`), while Fira Code is self-hosted by the parent site under `static/`.
