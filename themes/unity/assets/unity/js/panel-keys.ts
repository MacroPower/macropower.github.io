// The keyboard map of the top panel's dropdowns. panelKey() turns a key
// press into what the panel does, and top-panel.ts reads where focus
// sits, asks panelKey(), and acts on the answer. The module touches
// no DOM, so panel-keys.test.ts checks the map under Node.
//
// The File, Edit, View, and Help menus follow the WAI-ARIA menu button
// pattern, and the indicators follow the disclosure pattern. The arrow
// keys, Home, End, and Escape work the same in both, and the patterns
// differ on Tab. A menu's rows sit outside the tab order, so Tab closes
// the menu and moves on from its trigger. An indicator's dropdown keeps
// Tab for its controls, and top-panel.ts closes the dropdown when focus
// leaves it.

/** The panel's state when a key goes down. */
export interface PanelKeyState {
  /** Where focus sits: on a trigger, inside the open dropdown, or
   *  anywhere else on the page. */
  focus: "trigger" | "dropdown" | "elsewhere";
  /** Whether a dropdown is open. */
  open: boolean;
  /** Whether the open dropdown is a menu rather than a disclosure. */
  menu: boolean;
  /** Whether focus sits on an input, such as the volume slider. An
   *  input keeps its own Left, Right, Home, and End keys. */
  input: boolean;
}

/** A row of a dropdown, relative to the focused one. The rows are the
 *  controls that the arrow keys reach, in document order. */
export type Row = "next" | "previous" | "first" | "last";

/** What the panel does with a key. */
export type PanelIntent =
  /** Opens the focused trigger's dropdown and focuses its first or last
   *  row. */
  | { kind: "open"; row: "first" | "last" }
  /** Moves focus to another row of the open dropdown. */
  | { kind: "move"; row: Row }
  /** Opens the trigger after or before the open one, in document order. */
  | { kind: "switch"; step: 1 | -1 }
  /** Closes the open dropdown and focuses its trigger. The key's default
   *  action still runs, so Tab moves on from the trigger. */
  | { kind: "close" };

/** The intent of a key press, or null when the panel leaves the key to
 *  the browser. `modified` says whether Ctrl, Alt, or Meta is down, and
 *  the panel leaves every such chord to the browser. */
export function panelKey(key: string, modified: boolean, state: PanelKeyState): PanelIntent | null {
  if (modified) return null;
  if (key === "Escape") return state.open ? { kind: "close" } : null;
  if (state.focus === "trigger") {
    switch (key) {
      case "ArrowDown": return { kind: "open", row: "first" };
      case "ArrowUp": return { kind: "open", row: "last" };
      case "ArrowRight": return state.open ? { kind: "switch", step: 1 } : null;
      case "ArrowLeft": return state.open ? { kind: "switch", step: -1 } : null;
      default: return null;
    }
  }
  if (state.focus !== "dropdown") return null;
  switch (key) {
    case "ArrowDown": return { kind: "move", row: "next" };
    case "ArrowUp": return { kind: "move", row: "previous" };
    case "Tab": return state.menu ? { kind: "close" } : null;
    default: break;
  }
  if (state.input) return null;
  switch (key) {
    case "Home": return { kind: "move", row: "first" };
    case "End": return { kind: "move", row: "last" };
    case "ArrowRight": return { kind: "switch", step: 1 };
    case "ArrowLeft": return { kind: "switch", step: -1 };
    default: return null;
  }
}

/** The index of the row to focus among `count` rows, or -1 when there
 *  are none. `current` is the focused row's index, or -1 when focus sits
 *  on no row. Next and previous wrap around the ends, and from no row
 *  they focus the first and the last row. */
export function rowIndex(row: Row, current: number, count: number): number {
  if (count === 0) return -1;
  const last = count - 1;
  switch (row) {
    case "first": return 0;
    case "last": return last;
    case "next": return current === -1 ? 0 : (current + 1) % count;
    case "previous": return current === -1 ? last : (current + count - 1) % count;
  }
}
