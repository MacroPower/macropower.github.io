# Changelog

This file lists the notable changes to the unity theme for the sites that use it. It follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and the theme's versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The theme has no release yet. This section lists the changes after commit `5e05c78`. Each entry under Changed that your site must act on ends with the step to take. Template paths such as `_partials/unity/dash.html` name files under `layouts/`, in the theme and in your site.

### Added

- A script API for your site's own TypeScript. Import `notify()`, `dialog()`, and `whenReady()` from `unity/js/api`, together with the event names and the notification and dialog types. `dialog()` narrows its result to the ids of the call's buttons.
- Accent presets under `params.desktop.accents`. Your site adds a preset with a table of its own, removes one by setting it to `false`, and sets each preset's `color`, `light`, `lighter`, `dark`, `darker`, `label`, and `weight`. The theme mixes each shade that a preset leaves out from its `color`.
- `params.desktop.wallpaper`, an image under `assets/` or `static/`, or a URL, that covers the desktop and the lock screen.
- `params.desktop.fontPreload`. Set it to `false` when your font properties name other fonts, so pages stop preloading the theme's Ubuntu faces.
- `params.desktop.indicators`, which picks the top panel's indicators and their order. Add an indicator of your own as `layouts/_partials/unity/indicators/<name>.html` and list its name there.
- `menu.help`, whose entries join the end of the top panel's Help menu, ordered by weight.
- `params.projects.exclude`, `params.projects.languages`, and `params.projects.requireDescription`, which narrow the projects page and the Dash whether the projects come from `data/projects.yaml` or from GitHub.
- The `--up-font-sans` and `--up-font-mono` custom properties, which set the typefaces of the desktop, the terminal, and the Studio's piano roll.
- Defaults for `markup` and `taxonomies` that your site takes by setting `_merge = "deep"` on its own `[markup]` and `[taxonomies]` tables. They highlight code with classes, turn on the math delimiters, and declare the `categories` and `series` taxonomies.
- `imageAlt`, in front matter and in params, which gives share images their alt text. Each share image from a page bundle or `assets/` declares its width and height, and the theme shares a copy 1200 pixels wide of each JPEG, PNG, or WebP image that is wider.
- WebP copies of post images. Browsers load them when WebP makes an image smaller, and your site's `[imaging.webp]` settings tune them.
- `rel="me"` links from the home page to each `params.social` profile, which Mastodon and IndieAuth read to verify the profile.
- A JSON-LD graph on the home page with a WebSite and its owner's Person. Each post's BlogPosting points at both.
- `copyright` under each post, and as plain text in each feed.
- A `youtube` shortcode that replaces Hugo's. It takes Hugo's arguments and follows your `privacy.youtube` settings, but it sizes the player from the stylesheet, so it works under a Content Security Policy without `'unsafe-inline'`.
- Links to the item in feeds, in place of the Spotify and YouTube players, which a feed reader shows without the theme's stylesheet.
- Keyboard play in solitaire. The arrow keys move a cursor, Enter or Space holds cards and places them, P plays the hint, and Esc puts the held cards back.
- Tab, Shift+Tab, Home, and End in the top panel's menus. Tab and Shift+Tab close a menu and move on from its button, and Home and End jump to the first and last row.
- The working directory in the home terminal's window title, such as `user@host: ~/posts` after `cd posts`.
- Darker accent highlights behind white text when a visitor's system asks for more contrast, so the text contrasts 4.5:1 or more.
- Mirrored chrome for right-to-left languages. The top panel, its menus, and every window mirror, and the Left and Right keys follow the reading direction. Titles, tags, and other names from your site take the direction of their first letter, and shell lines stay left to right.

### Changed

- The theme keeps its partials under `layouts/_partials/unity/`, so your site's own partials, such as `head.html` or `author.html`, no longer replace them. Move each partial that your site copied to override the theme's to the same path under `layouts/_partials/unity/`. The `extend-head.html`, `extend-footer.html`, and `extend-post.html` hooks stay in `layouts/_partials/`.
- The project-language emblem partials moved from `_partials/page/icons/` to `_partials/unity/emblems/`. Move your copy of one to `layouts/_partials/unity/emblems/`.
- Every custom property of the theme starts with `--up-`. In `custom.css`, add the prefix to each theme property that your site reads or sets. Write `--up-accent`, `--up-accent-light`, `--up-accent-dark`, and `--up-accent-darker` for `--orange` and its shades, and `--up-terminal-bg` for `--hud`.
- Every rule that paints a custom property's role reads the property, so setting one in `custom.css` changes everything it paints. `--up-wallpaper` paints the desktop and the lock screen. If your site styled `body::before` or `body::after` to change the wallpaper, set `--up-wallpaper` or `params.desktop.wallpaper` instead.
- The accent presets live in params, and each page names its preset in `data-up-accent` on `<html>`. If your site set the accent properties under `:root:not([data-up-accent])`, add a preset under `params.desktop.accents` and name it in `params.desktop.accent` instead. Give each preset of your own a `color` that contrasts 4:1 or more with white, a `light` that contrasts 3:1 or more, and a `dark` and `darker` that contrast 4.5:1 or more.
- The theme puts its stylesheet in cascade layers and builds your `custom.css` after them with no layer, so your rules beat the theme's whatever their specificity. The theme's `!important` declarations still win. You may shorten each selector that you lengthened only to outrank the theme.
- Highlighted code takes its text and background colors from your `markup.highlight.style`, light or dark, and takes the window's colors where the style sets none. Code that Hugo does not highlight keeps the dark block.
- The top panel, the home terminal, and the other dark surfaces declare `color-scheme: dark`, so the browser draws their scrollbars and form controls dark. If your site paints the top panel or the home terminal light, set `color-scheme: light` on `.up-top-panel` or `.up-neofetch` in `custom.css`.
- The theme ships the `[markup]` and `[taxonomies]` settings that the README showed. Replace your site's copies with `_merge = "deep"` on each table, and add `tag = "tags"` beside the `_merge` to keep tags.
- The top panel renders each indicator from `_partials/unity/indicators/<name>.html` and its menus from `_partials/unity/top-panel/menus.html`, once per language with the site as context. If your site copied `_partials/unity/top-panel.html`, copy only the piece that you change instead. An indicator of your own must not show anything about the current page.
- Dropdowns take `data-align="start"` or `"end"` in place of `"left"` or `"right"`. Rename the values in your copy of `_partials/unity/lang-indicator.html` or `_partials/unity/ui/panel-menu.html`.
- Each indicator button names its dropdown through `aria-controls="up-dropdown-<key>"`, and the dropdown carries the matching `id`. Give each indicator of your own both attributes, and leave `aria-haspopup` off its button.
- Every menu row carries `tabindex="-1"`. If your site copied `_partials/unity/ui/menu-item.html`, add the attribute to its rows.
- Pages load each page script when they render the script's root element, whatever their layout, so a layout of your own can render one of the theme's page partials. If your site copied `baseof.html`, `icons.html`, `taxonomy.html`, `term.html`, or a partial under `_partials/unity/page/`, copy the theme's `.Store.SetInMap "unity-bundles"` line or its bundle loop into your copy.
- The icon vault renders from `_partials/unity/page/icons.html`. If your site copied `icons.html`, move the body of its `main` block to `layouts/_partials/unity/page/icons.html` in your site.
- A post page wraps its reader in a `<div>`, so the reader is the page's only `<article>`. If your site copied `_partials/unity/page/blog-post.html`, make the same change.
- The Dash's app tiles name the panel's actions in full, such as `dlg:prefs` and `daw:open`. If your site copied `_partials/unity/dash.html`, rename its tiles' actions the same way.
- The home terminal's window reads `user@host: ~`, from `params.terminal` and `baseURL`, unless `content/_index.md` sets a title. Remove a home title that your site set only to imitate a terminal, because that title also becomes the home page's `og:title` and `twitter:title`. If your site copied `_partials/unity/page/terminal.html`, add the theme's `cwdTitle` field to its data island, so the title follows the working directory.
- On a site without `params.author`, the owner's login takes the first word of the site's title in lowercase, as the README documents, where it used to read `user`. The login shows on the lock screen, in the user menu, in the Trash, and in the post sign-offs. Set `params.desktop.user = "user"` to keep `user`.
- `copyright` takes Markdown. Rewrite an HTML `copyright` as Markdown, because Hugo's Markdown renderer leaves out raw HTML unless your site allows it.
- The `spotify` shortcode writes no `width` unless you pass one, and the player fills its column. A `width` or `height` that is not a whole number of pixels fails the build, so drop a percentage width or pass pixels.
- The launcher, the Dash, and the HUD show each icon as an image file that the browser caches, which makes each page's HTML about half as large. Each icon of your own there must draw everything it shows itself, without the page's CSS or another file's ids. Icons that paint with `currentColor` stay inline.
- A `menu.main` entry whose `pageRef` finds no page, and that sets no `url`, drops out of that language's desktop and makes the build warn, where it used to lead to the home page. List `unity-menu-unresolved` in `ignoreLogs` to silence the warning.
- Several translation keys changed. Update your `i18n/<lang>.toml` files to match.

  | Replace | With |
  | --- | --- |
  | `search_noun_title`, `search_noun`, `filter_noun`, `posts_noun`, `projects_noun` | `search_posts_title`, `search_posts`, `filter_posts`, `search_projects_title`, `search_projects`, `filter_projects` |
  | `sorted_descending` | `col_date_sorted_desc` |
  | `js_blog_sorted_asc`, `js_blog_sorted_desc` | `js_blog_date_sorted_asc`, `js_blog_date_sorted_desc`, `js_blog_name_sorted_asc`, `js_blog_name_sorted_desc` |
  | `js_prefs_accent_<name>` | `accent_<name>` |
  | `js_projects_stat_label` | A `{value}` placeholder in `js_projects_stars`, `js_projects_forks`, `js_projects_license`, and `js_projects_updated` |
  | `js_solitaire_card`, `js_solitaire_suit_<suit>` | `js_solitaire_card_<suit>`, `js_solitaire_pile_foundation_<suit>` |
  | `page_count_of` | `page_of_total` |
  | `output` | `sound_output` |
  | `terminal_requires_js` | `terminal_needs_js` |
  | `spotify_player` | `spotify_player_<type>` |
  | The terminal's words in `kw_home` | `kw_terminal`, and the plain home page's words in `kw_home` |

  `posts_tagged` takes `{{ .Tag }}` and the sentence's final punctuation, and `no_terms_yet` reads `{{ .Plural }}: none yet.` in English. `solitaire_canvas` lists the keyboard cursor's keys, and the 404 page's title reads `page_not_found`. Translate these new keys too:

  - `feed_description`
  - `youtube_video`, `youtube_link`, `youtube_link_titled`, and `spotify_link`
  - `js_shortcuts_blog`, `js_shortcuts_projects`, `js_shortcuts_move_cursor`, `js_shortcuts_hold_place`, and `js_shortcuts_play_hint`
  - `js_solitaire_at_cards`, `js_solitaire_at_cards_down`, `js_solitaire_at_count`, `js_solitaire_at_empty`, `js_solitaire_holding`, `js_solitaire_no_fit`, `js_solitaire_nothing_to_hold`, `js_solitaire_pile_column`, `js_solitaire_pile_stock`, `js_solitaire_pile_waste`, and `js_solitaire_put_back`
- The keyboard shortcuts dialog lists only the surfaces your site has. It finds the projects grid and the solitaire table by the theme's `projects` and `solitaire` layouts, so it leaves out their keys on a site that renders them only under layouts of its own.
- Solitaire draws from the stock with S. Space and Enter act on the keyboard cursor, and they draw only when the cursor is on the stock.
- The blog reads `tags` on a site whose posts have tags and no categories, unless `params.blog.taxonomies.category` names another taxonomy.
- The projects page fetches the GitHub list again on the first build of each day, and the request fails after 10 seconds. An offline build on a new day warns and shows no projects.
- A site without MIDI files loads `js/app.js` without the Studio's code, and a site with them loads `js/app-studio.js`.
- Sites with many posts build in less time.
- The browser floor for Firefox is 121, the first release with the `:has()` selector that the stylesheet uses.

### Removed

- The `--aubergine`, `--aubergine-deep`, `--aubergine-mid`, `--aubergine-light`, and `--panel` custom properties. No rule read them, so setting them changed nothing.
- The `js_shortcuts_or` translation key. The shortcuts dialog joins key combos in the page's language through the browser.

### Fixed

- Focus rings, selected rows, and pressed toggles stay visible under Windows contrast themes and other forced colors. Each window has an edge there, and the focused window's titlebar fills with the system's highlight color.
- Focus rings contrast 3:1 or more with the surface under them. Selected rows, the titlebars, the launcher, the CV toolbar, the icon vault, and the copy button over a light code block each get such a ring.
- Accent text in the top panel's menus, dim menu text, the Dash and HUD placeholders, and the tip alert's title contrast 4.5:1 or more with their backgrounds.
- Each window's close, minimize, and maximize buttons take a click or tap anywhere in a 24px square, the WCAG 2.2 minimum target size.
- Screen readers announce the File, Edit, View, and Help menus as menus and the indicators as disclosure buttons. They skip the theme's decorative icons and name each sidebar section by its label.
- The solitaire table shows which of its toolbar buttons holds keyboard focus.
- Keyboard focus stays in solitaire when the game hides or disables the toolbar button that holds it. Focus moves from Hint to "Finish the game" when the game can finish itself. From every other such button, such as Undo after the last undo, it moves to the table, where the game's keys keep working.
- The post list and the projects grid leave each shortcut with Ctrl, Alt, or Meta to the browser, such as Alt+Left, Ctrl+L, and Ctrl+K. Ctrl+Enter and Shift+Enter on a post row open a new tab or window again.
- The post list and the projects grid take keys only from their own window. A key that a visitor types in a dialog, on the lock screen, in the Dash, or in the HUD stays there. For example, `/` keeps focus in the keyboard shortcuts dialog, and `jk` typed on a Dash tile lands in the Dash's search. The keys do nothing after the visitor closes or minimizes the page window.
- Reduce motion follows a change to the system setting without a reload, and it stops the smooth scrolling of the post and project lists and the page window's spring after a drag. Solitaire follows the choice in Edit > Preferences too.
- Reduce motion stops the tile glides on the projects page and in the Trash. After Clean Up Icons, and while a drag reorders the tiles, each tile appears in its new place at once.
- Dark surfaces draw their scrollbars and form controls dark, and the volume slider draws its track and fill in the theme's colors.
- A page without `title` front matter takes its title from its date or file name. A site without a title names its home page after the host of `baseURL`, and its owner after the home page. The 404 page's title follows the page's language.
- Each post's JSON-LD dates carry a time and a time zone, and an undated post leaves them out.
- Feeds have a description on a site without `params.description`, and each feed's `lastBuildDate` follows the newest `lastmod`.
- `robots.txt` names the sitemap that the build writes, such as a multilingual site's index or a renamed file, and names none when your site disables the sitemap.
- Post images and share images from a phone camera come out upright, with their upright width and height.
- Menu urls keep the case and characters that your site wrote, and `tel:` and `sms:` urls keep their scheme. Each url resolves under your `baseURL` and the language's prefix, whether or not it starts with the `baseURL`'s path.
- Sponsor `url`, `avatar`, and `sponsorUrl` values resolve to a file in the page's bundle, a file under `assets/`, or a path under your `baseURL`, so they work on a site served from a subdirectory.
- A `%` that starts no escape in a Markdown link or image, such as `[sale](/50%off)`, renders as `%25`, the way Hugo renders it without the theme's render hooks, instead of failing the build.
- Markdown links to `tel:` and `sms:` keep their scheme, where they used to lead to `#ZgotmplZ`.
- On a site at `https://example.org/sub/`, a menu url or Markdown link to `/sub` leads to the home page, where it used to lead to `/sub/sub`.
- A `javascript:`, `vbscript:`, or `data:` url in `menu.main`, `menu.help`, or `params.social` drops its entry, and the build warns. The File menu, the HUD, and the home terminal used to follow such a url. A `params.repoUrl` that is not an `http` or `https` address makes the build warn, and the Help menu leaves out View source.
- A `menu.main` entry with the identifier `home` keeps the Home tile's icon, search words, and exact match for each param that it leaves out. The Home tile then shows as current only on the home page.
- With `params.home.layout = "page"`, the Dash lists the home page as Home, and the keyboard shortcuts dialog leaves out the terminal's keys.
- On a site that gives each language its own `baseURL`, the language menu leads to each language's host.
- The language menu shows each language's name in that language's direction. A right-to-left name reads right to left on every page.
- A language with a regional English key, such as `en-gb`, no longer makes the build warn that its translation lacks the theme's keys. Its pages show the theme's English for those keys.
- A multilingual or multihost site builds its stylesheet once and publishes each font once, without Hugo's warnings about duplicate target paths.
- Two builds of the same site write identical files, so a deploy rewrites only the pages that changed.
- A value of `params.author.born` or of a project's `updated` that is not a date makes the build warn instead of failing it.
- A single string in place of the list in `params.desktop.indicators`, `params.desktop.networks`, `params.desktop.trash`, `params.desktop.label`, or `params.studio.playlist` counts as a list of one. Another value that is not a list, such as `trash = true`, makes the build warn instead of failing it.
- The pathbar, the post reader, the blog sidebar, and the projects page's no-JavaScript list no longer render a link with an empty `href`. Such a link leads back to the current page. A crumb for a page that your site does not render, such as the categories page under `disableKinds = ["taxonomy"]`, shows as text. Under `disableKinds = ["section"]`, the post reader leaves out its All posts link, and the sidebar leaves out its All place. A project without a `url` shows its name as text.
- One undated page no longer makes the banner's uptime count from year 1.
- The home terminal no longer dates an undated post or page year 1. `ls -l` lists such a file with the fixed date that the terminal gives each file that a visitor writes. The post's card and the no-JavaScript post list show no date for it. The card of a post without categories no longer ends in a dash.
- Text pasted into the home terminal cannot clear the screen through a C1 control character.
- The home terminal starts when a copy of `_partials/unity/page/terminal.html` leaves out a field of its data island.
- A copy of `_partials/unity/dialog-host.html` that leaves out a part of the dialog template disables dialogs instead of making every dialog call fail.
- An `@import url(...)` of an external stylesheet in `custom.css` lands at the top of the built stylesheet, where browsers load it.
- The no-JavaScript fallbacks of the terminal, projects, and CV pages keep their layout under a `style-src 'self'` policy.
- `hugo mod npm pack` collects no packages from the theme, and a change to the theme's dev tooling no longer warns your site that its packed dependencies are stale.
- The theme ships the Ubuntu Font Licence and Canonical's copyright notice beside its fonts, and the CV viewer's script keeps pdf.js's licence notice.

[Unreleased]: https://github.com/MacroPower/macropower.github.io/commits/main/themes/unity
