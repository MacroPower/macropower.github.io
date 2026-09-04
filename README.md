# jacobcolvin.com

My personal website, built with the in-tree [ubuntu-unity](themes/ubuntu-unity/README.md) Hugo theme.

## Development

```sh
devbox shell     # pinned Hugo, Dart Sass, and Node on PATH
hugo server -D   # local dev server with drafts
hugo --minify    # production build into public/
```

## Checks

```sh
npm test               # Vitest suites
npm run typecheck      # production sources
npm run typecheck:test # test sources
```
