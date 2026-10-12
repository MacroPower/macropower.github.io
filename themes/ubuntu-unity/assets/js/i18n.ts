// Runtime UI strings. _partials/ui/i18n.html renders every js_ key in the
// theme's i18n/en.toml through Hugo's T for the page's language and ships
// the result as window.UP_I18N, so a site's i18n/<lang>.toml translates
// the text the scripts write. Values use {name} placeholders. A missing
// key renders as the key itself, which i18n.test.ts keeps from happening.

import type { UPI18n } from "./types";

export type Vars = Record<string, string | number>;

// Guarded so a module that calls t() at load time still imports under
// Node, where tests run without a window.
function catalog(): UPI18n | undefined {
  return typeof window === "undefined" ? undefined : window.UP_I18N;
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match);
}

/** The page's language tag for Intl and toLocale*() formatting, so dates
 *  and numbers follow the page rather than the browser. */
export function locale(): string | undefined {
  return typeof document === "undefined" ? undefined : document.documentElement.lang || undefined;
}

/** The translated string for `key`, with `{name}` placeholders filled from `vars`. */
export function t(key: string, vars?: Vars): string {
  return fill(catalog()?.strings[key] ?? key, vars);
}

/**
 * The translated plural string for `key` and count `n`, which fills the
 * `{n}` placeholder. Hugo renders each plural key at every count from 0 to
 * 199 under the language's own rules, so the form comes from a lookup.
 * CLDR's integer rules repeat every hundred past 100, so a larger count
 * reads the entry for 100 plus its last two digits.
 */
export function tn(key: string, n: number, vars?: Vars): string {
  const plural = catalog()?.plurals[key];
  let text: string | undefined;
  if (plural) {
    const count = Math.abs(Math.trunc(n));
    const slot = count < plural.index.length ? count : 100 + (count % 100);
    text = plural.forms[Number(plural.index[slot])] ?? plural.forms[plural.forms.length - 1];
  }
  return fill(text ?? key, { n, ...vars });
}
