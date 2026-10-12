# CLAUDE.md

A standalone Hugo theme that renders a personal site as the Ubuntu 14.04 Unity desktop. Hugo partials server-render everything, `assets/css/main.css` styles it, and the TypeScript modules under `assets/js/` enhance the rendered DOM. Hugo Pipes bundles the TypeScript at site build time, so this directory has no build step of its own. README.md documents the surface a consuming site configures.

## Constraints

- A bare site with no params, menu, or data files must keep building. Guard every optional read. `npm run test:sites` builds `exampleSite/` and small sites of other shapes with warnings fatal, then checks their output. The example site must use every template. Add a site to `scripts/build-sites.mjs` when a fix covers a site shape the others miss.
- A site needs only Hugo, in either edition. Do not add anything that needs Node, npm, Dart Sass, or the extended edition at site build time.
- The Hugo version floor appears in `hugo.toml`, `theme.toml`, and the guard at the top of `baseof.html`. Change all three together.
- All desktop state is session-only by design. Only the terminal's command history persists.
- `main.css` is one file on purpose, and every selector is prefixed `up-`. Do not split it. It is plain CSS with native nesting, and `css.Build` in `_partials/head/css.html` lowers the nesting for the browser targets listed there.
- `main.css` has no mixins, so shared looks repeat inline after a `/* recipe: <name> */` marker. Grep the marker and change every copy together.
- Every string a template renders goes through `T "<key>"` from `i18n/en.toml`. Every string the desktop's scripts show goes through `t("js_<key>")` or `tn()` from `assets/js/i18n.ts`, with the English under the `js_` keys at the end of `en.toml`. `_partials/ui/i18n.html` renders those keys for the page's language, so a key must be a string literal, and `i18n.test.ts` checks that every key the scripts use exists and every `js_` key is used. The home terminal's output stays English, like the bash it imitates.
- A consuming site needs no npm. xterm.js and pdf.js are vendored under `assets/third_party/`, never a directory named `vendor`, because Go module zips drop `vendor` directories and a site importing the theme as a Hugo module would lose them, and `_partials/ui/script.html` shims the `@xterm/*` and `pdfjs-dist` imports to those files. `npm run vendor:xterm` and `npm run vendor:pdfjs` refresh them from the versions in `scripts/`. pdf.js ships no type declarations, so `assets/js/pdfjs.d.ts` declares the slice `cv.ts` uses. The structural CSS from `@xterm/xterm` is inlined in `main.css` under a version pin, so bump it with the vendored copy.

## Layouts

- `baseof.html` is the only base template. It wraps `{{ block "main" }}` in the page window, so a layout's `main` block emits inner content only and never its own outer wrapper or titlebar.
- Templates never name the blog section or its taxonomies. `_partials/blog-section.html` resolves the section from `mainSections`, `_partials/in-blog.html` is the "is this a post" test, and `_partials/blog-posts.html` lists the posts. Never test `in site.MainSections .Section` directly, because Hugo sets `mainSections` to `[""]` on a site without sections. `_partials/blog-taxonomies.html` names the category and series taxonomies, and `_partials/post-categories.html` reads a post's categories.
- Bespoke pages select `layouts/<layout>.html` through `layout` front matter, and each one renders `_partials/page/<layout>.html`. Adding a page means adding both files and documenting the front matter the partial reads in its header comment.
- `_partials/author.html` normalizes `params.author`, which a site may set as a table or a plain name, so read the owner through it. `_partials/socials.html` does the same for `params.social`, and `_partials/projects-data.html` fills in each project's optional keys.
- `_partials/site-pages.html` is the page registry built from `menu.main`. The launcher, Dash, HUD, File menu, and `nav:<key>` actions all read it.
- `_partials/projects-data.html` resolves the projects from `data/projects` or, without it, the GitHub API. The projects page and the Dash read projects only through it.
- `_partials/lang-indicator.html` renders nothing on a monolingual site, so a bare site's panel stays unchanged.
- `_partials/playlist.html` resolves the Studio's MIDI files from the site. An empty playlist removes every Studio surface, so gate any new one on it.
- The accent preset names appear in `main.css`, `ACCENTS` in `prefs.ts`, and the `params.desktop.accent` check in `baseof.html`. Change all three together.
- `baseof.html` ships the blog, projects, cv, solitaire, icons, and shell bundles only to the pages that use them.
- `rss.xml` renders every feed. The home feed lists the blog's posts only, so utility pages never surface as entries.
- The render hooks under `_markup/` own Markdown output. A hook whose markup a feed reader cannot use has a `.rss.xml` twin, and the link and image hooks share their resolution with their twins through `_partials/markup/`. Change a hook and its twin together.
- `_partials/head/meta.html` renders all search and share metadata. The theme does not call Hugo's embedded `opengraph.html` or `twitter_cards.html`, because they describe the home page by its body, which is the terminal's README.
- `head.html` renders `_partials/extend-head.html` last, and `_partials/head/css.html` appends the site's `assets/css/custom.css` to the stylesheet; `baseof.html` renders `_partials/extend-footer.html` before `</body>`; `page/post-reader.html` renders `_partials/extend-post.html` after a post's body. The hook partials ship empty and are the documented override points, so keep them.

## DOM contracts

TypeScript types the JavaScript surface but not the DOM. Each module selects its root by a `data-*` attribute and no-ops when the attribute is absent. Renaming any `data-*` attribute or `up-` class a module reads breaks it silently, so grep `assets/js/` before renaming anything in a partial. The larger partials list the attributes their module reads in a header comment. The HUD indexes the top panel's rendered menus as its search index, so that markup is a contract too.

`baseof.html` injects `window.UP_SITE` before the bundles load. The `Window` augmentation in `assets/js/types.ts` must match it.

## Cross-bundle contracts

The app, projects, and shell bundles are separate IIFEs and cannot import each other at runtime.

- `shell/terminal.ts` listens for the literal string `"up:page-window-state"`, which duplicates `WINDOW_STATE_EVENT` in `page-window.ts`. `shell/commands/notify.ts` dispatches the literal `"up:notify"`, which duplicates `NOTIFY_EVENT` in `notify.ts`. Importing either module would inline its side effects into the shell bundle, so the strings are duplicated by design. Rename both ends together.
- esbuild copies `desktop-select.ts` and `projects-desktop.ts` into both the app and projects bundles, so two instances coexist on the projects page. Keep all of their state inside the `createSelection` and `installDesktop` closures, and never add module-level mutable state to either file.

## Editing notes

- `app.ts` initializes the modules in a deliberate order, and its comments explain each dependency. Add new calls after the ones they depend on, wrapped in `run()` so one module's failure leaves the rest working. It dispatches `up:ready` on `document` last, which README.md documents for sites' own scripts.
- A new top-panel action is a `data-action` row in `_partials/top-panel.html` plus a case in `dispatchAction()` in `top-panel.ts`. The Dash's app tiles run the same `dlg:*` cases.
- `shortcuts.ts` is a static table of bindings implemented elsewhere. Update it when a binding changes.
- A new terminal command is a `shell/commands/*.ts` module appended to `ALL_COMMANDS` in `commands/all.ts`, which both the entrypoint and the test kit consume. Set `builtin: true` only for commands bash treats as builtins, because the flag decides whether `/usr/bin/<name>` exists.
- The shell core imports `terminal.ts` as a type only, so it runs headless. `shell/testkit.ts` runs the same programs through the shell and real bash and asserts they agree. Keep `vfs.ts` DOM-free and deterministic. Written nodes use the fixed `SESSION_MTIME`, and sizes derive from content, so golden `ls` output stays stable.
- Tests are `*.test.ts` files under `assets/js/`. Run them with `npm test` from this directory or from the site root.
