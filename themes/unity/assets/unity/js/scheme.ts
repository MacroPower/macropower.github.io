// The color scheme of the windows and dialogs, light or dark. A visitor's
// choice from the top panel's toggle persists in localStorage. Without a
// choice, the scheme follows the system's preference. main.css paints the
// dark scheme under data-up-scheme="dark" on <html>.
//
// scheme-boot.ts applies the scheme from a blocking script in <head>, so
// the first paint already shows it. It then follows the system's
// preference. initSchemeToggle() runs in the app bundle and
// wires the toggle. The two bundles each get a copy of this module, so it
// keeps every piece of state in localStorage and on <html>.

export type Scheme = "light" | "dark";

// One key for every site on the origin, because the choice belongs to the
// visitor, not to one site.
const SCHEME_KEY = "up:scheme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The visitor's stored choice, or null without one. */
export function storedScheme(): Scheme | null {
  try {
    const value = localStorage.getItem(SCHEME_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // localStorage might be unavailable, as in private mode.
    return null;
  }
}

/** The scheme that the system prefers. */
export function systemScheme(): Scheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/** The scheme that the page shows: the stored choice, or the system's. */
export function currentScheme(): Scheme {
  return storedScheme() ?? systemScheme();
}

/** Paints the page in a scheme. */
export function applyScheme(scheme: Scheme): void {
  document.documentElement.setAttribute("data-up-scheme", scheme);
}

/** The scheme that the page shows, which differs from currentScheme()
 *  after a choice that localStorage could not keep. */
export function shownScheme(): Scheme {
  return document.documentElement.getAttribute("data-up-scheme") === "dark" ? "dark" : "light";
}

/** Stores a choice and paints the page in it. A choice that matches the
 *  system's preference clears the stored one, so the page follows the
 *  system again. */
export function chooseScheme(scheme: Scheme): void {
  try {
    if (scheme === systemScheme()) localStorage.removeItem(SCHEME_KEY);
    else localStorage.setItem(SCHEME_KEY, scheme);
  } catch {
    // Without localStorage, the choice lasts until the next page load.
  }
  applyScheme(scheme);
}

// Follows the system's preference while the visitor has no stored
// choice, then calls after.
function followSystem(after?: () => void): void {
  window.matchMedia(DARK_QUERY).addEventListener("change", () => {
    if (storedScheme() === null) applyScheme(systemScheme());
    after?.();
  });
}

/** Applies the current scheme, then follows the system's preference. */
export function bootScheme(): void {
  applyScheme(currentScheme());
  followSystem();
}

/** Wires the top panel's toggle, which flips the scheme on each click. A
 *  site that turns dark mode off renders no toggle. */
export function initSchemeToggle(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-scheme-toggle]");
  if (!toggle) return;
  const sync = (): void => {
    toggle.setAttribute("aria-pressed", String(shownScheme() === "dark"));
  };
  toggle.addEventListener("click", () => {
    chooseScheme(shownScheme() === "dark" ? "light" : "dark");
    sync();
  });
  followSystem(sync);
  sync();
}
