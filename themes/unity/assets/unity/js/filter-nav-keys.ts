// The keyboard map of the post list and the projects grid. filterNavKey()
// turns a key press into what the list does, and filter-nav.ts finds
// the items and acts on the answer. The module touches no DOM, so
// filter-nav-keys.test.ts checks the map under Node.
//
// The list leaves every chord with Ctrl, Alt, or Meta to the browser,
// such as Alt+Left for Back and Ctrl+L for the address bar. It also
// leaves Shift+Enter to the browser, so Shift+Enter on a focused post
// row opens the post in a new window.

import type { InlineKey } from "./inline-keys";

/** The keys that move the cursor. "vertical" accepts Up, Down, j, and
 *  k. "both" also accepts Left, Right, h, and l for a grid. */
export type FilterNavAxis = "vertical" | "both";

/** The modifier keys that are down with a key. */
export interface KeyModifiers {
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  shift: boolean;
}

/** What the list does with a key. */
export type FilterNavIntent =
  /** Opens the item under the cursor. */
  | { kind: "activate" }
  /** Moves the cursor to another item, in document order. */
  | { kind: "move"; to: "next" | "prev" | "first" | "last" }
  /** Moves the cursor along a row of the grid. The list reads the
   *  grid's inline direction to turn the key into a step. */
  | { kind: "inline"; key: InlineKey };

// The vi keys stand for the arrow keys.
const VI_ARROWS: Readonly<Record<string, "ArrowLeft" | "ArrowDown" | "ArrowUp" | "ArrowRight">> = {
  h: "ArrowLeft",
  j: "ArrowDown",
  k: "ArrowUp",
  l: "ArrowRight",
};

const LIST_KEYS: ReadonlySet<string> = new Set([
  "ArrowDown", "j",
  "ArrowUp", "k",
  "Home", "End", "Enter",
]);

const GRID_KEYS: ReadonlySet<string> = new Set([
  ...LIST_KEYS,
  "ArrowRight", "l",
  "ArrowLeft", "h",
]);

/** The intent of a key press, or null when the list leaves the key to
 *  the browser or to the focused control. */
export function filterNavKey(key: string, mods: KeyModifiers, axis: FilterNavAxis): FilterNavIntent | null {
  if (mods.ctrl || mods.alt || mods.meta) return null;
  if (!(axis === "both" ? GRID_KEYS : LIST_KEYS).has(key)) return null;
  if (key === "Enter") return mods.shift ? null : { kind: "activate" };
  switch (VI_ARROWS[key] ?? key) {
    case "ArrowDown": return { kind: "move", to: "next" };
    case "ArrowUp": return { kind: "move", to: "prev" };
    case "Home": return { kind: "move", to: "first" };
    case "End": return { kind: "move", to: "last" };
    case "ArrowLeft": return { kind: "inline", key: "ArrowLeft" };
    case "ArrowRight": return { kind: "inline", key: "ArrowRight" };
    default: return null;
  }
}
