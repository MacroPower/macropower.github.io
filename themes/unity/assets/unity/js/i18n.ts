// Runtime UI strings. _partials/unity/ui/i18n.html renders every js_ key in the
// theme's i18n/en.toml through Hugo's T for the page's language.
// _partials/unity/ui/runtime.html ships the result as window.UP_I18N, so a
// site's i18n/<lang>.toml translates the text the scripts write. Values
// use {name} placeholders. A missing key renders as the key itself.
// i18n-keys.ts types each key and the placeholders that its string fills,
// so tsc rejects a key that en.toml lacks and a call that misses or
// misspells a placeholder. `npm run i18n:types` generates it from en.toml.

import type { Messages, Plurals } from "./i18n-keys";
import type { UPI18n } from "./types";

type Vars = Record<string, string | number>;

/** The rest parameter of a call that reads key `K` of table `T`. It takes
 *  one value for each placeholder that the key's string fills, or nothing
 *  when the string has none. A key that the table lacks makes tsc infer
 *  `K` as every key, and the first branch then accepts any vars, so the
 *  error names the key rather than the argument count. */
type Fill<T, K extends keyof T> =
  [keyof T] extends [K] ? [vars?: Vars] :
  [T[K]] extends [never] ? [] : [vars: Record<T[K] & string, string | number>];

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
 *  and numbers follow the page rather than the browser. A tag Intl
 *  rejects, such as "en_US", yields undefined, the browser's default. */
export function locale(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const tag = document.documentElement.lang;
  if (!tag) return undefined;
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/**
 * `s` between U+2068 FIRST STRONG ISOLATE and U+2069 POP DIRECTIONAL
 * ISOLATE, the plain-text form of `<bdi dir="auto">`. The name then takes
 * the direction of its first letter and leaves the sentence's punctuation
 * in place, so a right-to-left name reads the same in a left-to-right
 * sentence as in its own row. Pass each value that a site's config, data,
 * or content fills into a translated sentence through it, such as a
 * network or page name. Numbers and translated words take the sentence's
 * direction and stay bare.
 */
export function isolate(s: string): string {
  return `⁨${s}⁩`;
}

/** The translated string for `key`, with `{name}` placeholders filled from `vars`. */
export function t<K extends keyof Messages>(key: K, ...vars: Fill<Messages, K>): string;
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
export function tn<K extends keyof Plurals>(key: K, n: number, ...vars: Fill<Plurals, K>): string;
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
