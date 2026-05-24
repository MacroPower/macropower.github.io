# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Hugo theme that styles a personal site as the Ubuntu 14.04 Unity desktop: top panel, vertical launcher dock, a single "window" containing the page content, and a trash icon. Everything is server-rendered by Hugo partials and styled by `assets/css/main.scss`; small TypeScript modules under `assets/js/` enhance the SSR DOM (dropdown toggling, drag, clock tick, dialog stack, etc.). The TS compiles through Hugo Pipes (`resources.Get | js.Build | resources.Fingerprint`) at site-build time, called from `baseof.html` and `head.html` — there is no separate build step inside this directory.

## Anatomy

- `assets/css/main.scss` (~1200 lines) — every Unity-styled selector lives here, all prefixed `up-` (Ubuntu/Unity). One file by design; do not split it.
- `assets/js/app.ts` — entry point. Calls `initDialogs`, `initTopPanel`, `initTrash`, `installPageWindow`, then tags `<body>` with `up-ready`.
- `assets/js/blog.ts` — IIFE module. Drives the post list's filter/sort/search and the focused single-post reader. Manipulates server-rendered DOM directly (`data-up-post-row`, `data-up-search-*`, etc.).
- `assets/js/dialogs.ts` — clones `<template id="up-dialog-template">` once per `window.uiDialog(opts)` call, fills slots, stacks modal dialogs, handles Esc/Enter, backdrop-shake, and titlebar drag via CSS custom properties `--ox` / `--oy` so the shake keyframe respects per-dialog drag offset.
- `assets/js/drag.ts` — `installTitlebarDrag(el, opts)` shared by page-window and trash. `spring: true` reproduces the page-window rubber-band; `spring: false` (trash) freezes the chrome at release. Optional `yMin` clamps the final viewport-y, optional `gate` predicate suppresses drag based on outer state (maximized, transitioning).
- `assets/js/focus.ts` — tiny pub/sub for whether the trash window currently has focus. `page-window.ts`, `trash.ts`, and `top-panel.ts` all subscribe so only one window/title looks focused at a time.
- `assets/js/page-window.ts` — wires the page window's titlebar buttons (close/min/max), drag, and launcher-tile state. Communicates outward via the `WINDOW_STATE_EVENT` custom event on `window`.
- `assets/js/top-panel.ts` — enhances `partials/top-panel.html`. Toggles the SSR `[data-dropdown-for]` siblings via the `hidden` attribute, ticks the clock every 30 s, rebuilds `[data-calendar]` on each clock open, runs the volume slider, dispatches `[data-action]` clicks (`nav:<key>`, `dlg:<key>`, `reload`, `fullscreen`, `vol-toggle`).
- `assets/js/trash.ts` — owns the trash window's open/minimize/close state machine, launcher-tile cycle, focus sync, and titlebar drag via `drag.ts`.
- `assets/js/types.ts` — shared types for the modules above and a `declare global { interface Window {...} }` block typing the runtime surface assigned to `window` (`UP_SITE`, `UP_PAGE_WINDOW_STATE`, `uiDialog`).

## Layout contracts

- `layouts/_default/baseof.html` is the only base template. It renders the chrome partials (`top-panel`, `launcher`, `window-frame-open`, `{{ block "main" }}`, `window-frame-close`, `dialog-host`, `trash-window`) in that order. The `window-frame-open`/`window-frame-close` pair sandwich the content — `window-frame-open.html` opens `<div.up-window-stage> > <section.up-window-chrome data-page-window> > <div.up-titlebar> + <div.up-window-body>`, and `window-frame-close.html` closes them. Any layout's `{{ define "main" }}` body must emit inner content only; no extra outer wrapper, no overriding the titlebar.
- `layouts/_default/single.html` checks `.File.BaseFileName` against a `{"about","cv"}` allowlist and dispatches to `partials/page/<name>.html` for those pages; everything else falls through to a generic `<article.up-page>` wrapper. To add a bespoke top-level page (e.g. `now.md`), add `now` to the allowlist and create `partials/page/now.html`.
- `layouts/posts/{list,single}.html` are the blog index and post pages. They share `partials/page/post-pathbar.html` (the Nautilus-style breadcrumb), `post-list.html`, `post-reader.html`, `post-sidebar.html`, and `post-list-empty-reader.html`.

## DOM contracts JS depends on

The Hugo partials must keep emitting these. Rename any and the corresponding TS module silently stops working — TypeScript types the JS surface but not the DOM contract.

- `[data-page-window]` — the page window chrome element. Selected by `installPageWindow()`.
- `[data-titlebar]`, `.up-tl-close`, `.up-tl-min`, `.up-tl-max` — titlebar and traffic-light buttons inside any window.
- `[data-up-window="trash"]` — the trash stage element (toggled via the `hidden` attribute).
- `[data-launcher="trash"]`, `[data-launcher-trash]` — launcher tile that toggles + mirrors trash state.
- `.up-launcher-tile[data-page-current]` (current page) and `.up-launcher-tile.is-active:not([data-launcher-trash])` (active fallback) — launcher tile that mirrors page-window state.
- `[data-panel-trigger]` plus a sibling `[data-dropdown-for="<key>"]` — every top-panel menu/indicator. `top-panel.ts` toggles `hidden` on the dropdown.
- `[data-flyout-keepopen]` — opts a dropdown out of the global click-to-close handler (used by every flyout that needs interactive controls inside).
- `[data-panel-slot="title"]`, `[data-clock-wide]`, `[data-clock-narrow]`, `[data-clock-longdate]`, `[data-calendar]`, `[data-vol-slider]`, `[data-vol-readout]`, `[data-vol-glyph]`, `[data-net-name]`/`[data-net-on]`, `[data-action]`, `[data-trash-empty]` — narrower contracts read by `top-panel.ts` and `trash.ts`.
- `#up-dialog-host` (empty container) and `#up-dialog-template` (the dialog shell) — `dialogs.ts` clones the template per `uiDialog()` call into the host.
- `[data-blog-kind]` — root for `blog.ts`; on absence, the script no-ops and returns immediately.
- `[data-up-post-list]`, `[data-up-post-list-body]`, `[data-up-post-row]`, `[data-up-post-empty]`, `[data-up-search-toggle]`, `[data-up-search-bar]`, `[data-up-search-input]`, `[data-up-search-count]`, `[data-up-search-close]`, `[data-up-sort]` — filter/sort/search surface.

## Site-provided globals

`baseof.html` injects `window.UP_SITE = { handle, github, rss }` from `Site.Params.author.name`, `Site.Params.social[name=github]`, and the RSS output format before the JS bundle loads. Components that need site identity (e.g. the top-panel session menu) read from `window.UP_SITE` rather than re-deriving from the DOM. The `Window` augmentation lives in `assets/js/types.ts`; keep it in sync if you add new globals.

## Editing notes

- `hugo.IsProduction` controls esbuild minification of the app and blog bundles; the CSS pipeline is `css.Sass | resources.Minify | resources.Fingerprint`, with `outputStyle: expanded` passed to Dart Sass so Hugo's minifier remains the size-reducing step. SRI integrity attributes are emitted for every fingerprinted asset.
- Fonts are split: Ubuntu / Ubuntu Mono come from Google Fonts (preconnected in `head.html`), while Fira Code is self-hosted by the parent site under `static/`.
- New dropdown content goes in `partials/top-panel.html` as a `[data-dropdown-for=<key>]` sibling of the matching trigger; new actionable rows just need `data-action`. Add a case to `dispatchAction()` in `top-panel.ts` if the action key is new.
