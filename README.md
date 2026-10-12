# jacobcolvin.com

My personal website, built with the in-tree [unity](themes/unity/README.md) Hugo theme.

## Development

```sh
devbox shell     # pinned Hugo and Node on PATH
hugo server -D   # local dev server with drafts
hugo --minify    # production build into public/
```

## Checks

```sh
npm test               # Vitest suites
npm run typecheck      # production sources
npm run typecheck:test # test sources
npm run test:sites     # theme example and bare sites, warnings fatal
```

The root `package.json` is an npm workspace over the theme, so these run the theme's own scripts and dev dependencies.
