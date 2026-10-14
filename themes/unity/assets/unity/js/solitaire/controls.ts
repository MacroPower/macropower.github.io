// The solitaire table's controls. The table draws a button for each
// TableButton in its bottom bar, and _partials/unity/page/solitaire.html
// renders a screen-reader toolbar button for each ToolbarAction. CSS hides
// the toolbar from sight, so the table rings the drawn twin of the focused
// toolbar button. controls.test.ts checks the partial against this table.

/** The buttons the table draws, left to right. AUTO takes HINT's slot when
 *  the game can finish itself, so the table shows one of the two. */
export const TABLE_BUTTONS = ["new", "undo", "hint", "auto", "draw", "sound"] as const;
export type TableButton = (typeof TABLE_BUTTONS)[number];

/** The toolbar's actions: every table button, plus draw-stock, whose twin
 *  on the table is the stock pile. */
export const TOOLBAR_ACTIONS = [...TABLE_BUTTONS, "draw-stock"] as const;
export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

export function isToolbarAction(id: string): id is ToolbarAction {
  return TOOLBAR_ACTIONS.some((action) => action === id);
}
