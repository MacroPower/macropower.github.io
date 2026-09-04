# CLAUDE.md

Hugo site for jacobcolvin.com, deployed to GitHub Pages from `main`. The only theme is `themes/ubuntu-unity/`. It lives in-tree but is written as a standalone theme with its own README and CLAUDE.md, so read those for anything under it.

## Commands

- `devbox shell` puts the pinned Hugo, Dart Sass, and Node on PATH and installs the git hooks.
- `hugo server -D` serves the site locally with drafts. `hugo --minify` is the production build CI runs.
- `npm test`, `npm run typecheck`, and `npm run typecheck:test` run the theme's Vitest and tsc passes from the repo root. CI runs all three before the Hugo build.
- `task populate-projects` regenerates `data/projects.yaml` from GitHub.

## Rules

- Load the `prose` skill before writing any prose, including docs, comments, and commit messages.
- Hugo, Dart Sass, and Node versions are pinned in both `devbox.json` and `.github/workflows/gh-pages.yml`. Bump both together.
- Post URLs follow `/posts/:year/:month/:title/`, so changing a post's title or date breaks its URL. The `slug` front matter only names the post's file in the home terminal.
- The xterm packages are declared in the root `package.json` and in the theme's `package.json` and `package.hugo.json`. Bump all three together and commit the refreshed `package-lock.json`, or `npm ci` fails in CI.
- PRs build but do not deploy, and there is no preview environment. Validate changes with `hugo server`.
- To customize a theme template or asset, copy it to the same path at the repo root. `assets/home/ascii.txt` overrides the terminal banner art this way.
