# jacobcolvin.com

My personal website.

## Development

```sh
devbox shell     # pinned Hugo, Dart Sass, and Node on PATH
hugo server -D   # local dev server with drafts
hugo --minify    # production build into public/
```

## Checks

```sh
npm test             # Vitest suites
npm run typecheck    # production sources
npm run typecheck:test
```
