# CLAUDE.md

A standalone Hugo theme that renders a personal site as the Ubuntu 14.04 Unity desktop. Hugo partials server-render everything, `assets/css/main.scss` styles it, and the TypeScript modules under `assets/js/` enhance the rendered DOM. Hugo Pipes bundles the TypeScript at site build time, so this directory has no build step of its own. README.md documents the surface a consuming site configures.

## Constraints

- A bare site with no params, menu, or data files must keep building. Guard every optional read. CI builds `exampleSite/` to check this.
- All desktop state is session-only by design. Only the terminal's command history persists.
- `main.scss` is one file on purpose, and every selector is prefixed `up-`. Do not split it.
- Every string a template renders goes through `T "<key>"` from `i18n/en.toml`. Strings JavaScript writes at runtime stay English.
- Hugo's esbuild resolves the xterm packages from the consuming site's `node_modules`, never from this directory. `package.hugo.json` declares them for `hugo mod npm pack`. The structural CSS from `@xterm/xterm` is inlined in `main.scss` under a version pin, so bump it with the package.

## Layouts

- `baseof.html` is the only base template. It wraps `{{ block "main" }}` in the page window, so a layout's `main` block emits inner content only and never its own outer wrapper or titlebar.
- Templates never name the blog section. `_partials/blog-section.html` resolves it from `mainSections`, and `in site.MainSections .Section` is the "is this a post" test.
- Bespoke pages select `layouts/<layout>.html` through `layout` front matter, and each one renders `_partials/page/<layout>.html`. Adding a page means adding both files and documenting the front matter the partial reads in its header comment.
- `_partials/site-pages.html` is the page registry built from `menu.main`. The launcher, Dash, HUD, File menu, and `nav:<key>` actions all read it.
- `baseof.html` ships the blog, projects, cv, solitaire, icons, and shell bundles only to the pages that use them.

## DOM contracts

TypeScript types the JavaScript surface but not the DOM. Each module selects its root by a `data-*` attribute and no-ops when the attribute is absent. Renaming any `data-*` attribute or `up-` class a module reads breaks it silently, so grep `assets/js/` before renaming anything in a partial. The larger partials list the attributes their module reads in a header comment. The HUD indexes the top panel's rendered menus as its search index, so that markup is a contract too.

`baseof.html` injects `window.UP_SITE` before the bundles load. The `Window` augmentation in `assets/js/types.ts` must match it.

## Cross-bundle contracts

The app, projects, and shell bundles are separate IIFEs and cannot import each other at runtime.

- `shell/terminal.ts` listens for the literal string `"up:page-window-state"`, which duplicates `WINDOW_STATE_EVENT` in `page-window.ts`. `shell/commands/notify.ts` dispatches the literal `"up:notify"`, which duplicates `NOTIFY_EVENT` in `notify.ts`. Importing either module would inline its side effects into the shell bundle, so the strings are duplicated by design. Rename both ends together.
- esbuild copies `desktop-select.ts` and `projects-desktop.ts` into both the app and projects bundles, so two instances coexist on the projects page. Keep all of their state inside the `createSelection` and `installDesktop` closures, and never add module-level mutable state to either file.

## Editing notes

- `app.ts` initializes the modules in a deliberate order, and its comments explain each dependency. Add new calls after the ones they depend on.
- A new top-panel action is a `data-action` row in `_partials/top-panel.html` plus a case in `dispatchAction()` in `top-panel.ts`. The Dash's app tiles run the same `dlg:*` cases.
- `shortcuts.ts` is a static table of bindings implemented elsewhere. Update it when a binding changes.
- A new terminal command is a `shell/commands/*.ts` module appended to `ALL_COMMANDS` in `commands/all.ts`, which both the entrypoint and the test kit consume. Set `builtin: true` only for commands bash treats as builtins, because the flag decides whether `/usr/bin/<name>` exists.
- The shell core imports `terminal.ts` as a type only, so it runs headless. `shell/testkit.ts` runs the same programs through the shell and real bash and asserts they agree. Keep `vfs.ts` DOM-free and deterministic. Written nodes use the fixed `SESSION_MTIME`, and sizes derive from content, so golden `ls` output stays stable.
- Tests are `*.test.ts` files under `assets/js/`. Run them with `npm test` from this directory or from the site root.
