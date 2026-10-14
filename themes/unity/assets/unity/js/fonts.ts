// main.css names its two font stacks as --up-font-sans and --up-font-mono
// on :root. xterm.js and a canvas take a family list as a plain string and
// cannot resolve var(), so the scripts that draw text read the computed
// token here.

/** The default --up-font-mono stack in main.css. fonts.test.ts checks
 *  that the two agree. */
export const MONO_STACK = '"Ubuntu Mono", ui-monospace, Menlo, monospace';

/** The --up-font-mono stack in effect at el, or MONO_STACK when the
 *  token is empty there. Reading it at the element keeps an override a
 *  site scopes to one surface. */
export function monoFamily(el: Element): string {
  return getComputedStyle(el).getPropertyValue("--up-font-mono").trim() || MONO_STACK;
}
