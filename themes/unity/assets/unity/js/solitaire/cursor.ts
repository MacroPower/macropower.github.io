// The keyboard cursor on the solitaire table, without the DOM. index.ts
// draws the cursor and reads its moves aloud, and cursor.test.ts drives it
// through hand-built games.
//
// The table has two rows. The top row holds the stock, the waste, and the
// four foundations, which sit over columns 0, 1, and 3 to 6 of the tableau.
// Left and Right step between the piles of a row. Up and Down step along
// the face-up cards of a column, and they cross between the rows at a
// column's ends. The cursor lands on a pile's top card whenever it enters
// the pile, because the top card is the one most plays move.

import { sameLoc, type Card, type Klondike, type Loc } from "./klondike";

export type Direction = "left" | "right" | "up" | "down";

/** A spot on the table: a pile and the position of a card in it. On an
 *  empty pile, `index` is 0 and names the pile's empty slot. */
export interface Cursor {
  readonly loc: Loc;
  readonly index: number;
}

/** What Enter does at the cursor. */
export type CursorAction =
  /** The cursor is on the stock, so Enter turns it or recycles the waste. */
  | { readonly type: "draw" }
  /** Enter holds the run that starts at the cursor. */
  | { readonly type: "hold"; readonly run: readonly [Card, ...Card[]] }
  /** Enter moves the held run onto the cursor's pile. `fits` says whether
   *  the rules take the run there. */
  | {
    readonly type: "place";
    readonly run: readonly [Card, ...Card[]];
    readonly from: Cursor;
    readonly to: Loc;
    readonly fits: boolean;
  }
  /** The cursor is on the held run's own pile, so Enter drops the run,
   *  which stays where it was. */
  | { readonly type: "drop"; readonly run: readonly Card[] }
  /** No card at the cursor can move. */
  | { readonly type: "none" };

const STOCK: Readonly<Loc> = { kind: "stock", pile: 0 };

/** The top row, left to right, with the tableau column under each pile. */
const TOP_ROW: readonly { readonly loc: Loc; readonly col: number }[] = [
  { loc: STOCK, col: 0 },
  { loc: { kind: "waste", pile: 0 }, col: 1 },
  { loc: { kind: "foundation", pile: 0 }, col: 3 },
  { loc: { kind: "foundation", pile: 1 }, col: 4 },
  { loc: { kind: "foundation", pile: 2 }, col: 5 },
  { loc: { kind: "foundation", pile: 3 }, col: 6 },
];

const COLUMNS = 7;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** The lowest index the cursor can take in a pile. In a tableau column it
 *  is the first face-up card, because a face-down card never moves. */
function lowest(game: Klondike, loc: Loc): number {
  const pile = game.pile(loc);
  const top = Math.max(0, pile.length - 1);
  if (loc.kind !== "tableau") return top;
  const first = pile.findIndex((card) => card.faceUp);
  return first < 0 ? top : first;
}

/** The cursor on the top card of the pile at `loc`. */
export function topOf(game: Klondike, loc: Loc): Cursor {
  return { loc, index: Math.max(0, game.pile(loc).length - 1) };
}

/** Where a fresh deal puts the cursor: on the stock. */
export function startCursor(game: Klondike): Cursor {
  return topOf(game, STOCK);
}

/** The nearest spot to `c` that the cursor can take after the piles
 *  change. Outside the tableau that is the pile's top card, and in a
 *  column it is the nearest face-up card. */
export function clampCursor(game: Klondike, c: Cursor): Cursor {
  const top = Math.max(0, game.pile(c.loc).length - 1);
  return { loc: c.loc, index: clamp(c.index, lowest(game, c.loc), top) };
}

/** The pile over tableau column `col`. Column 2 has none, so it takes the
 *  waste, the nearest pile on its left. */
function aboveColumn(col: number): Loc {
  return TOP_ROW.findLast((e) => e.col <= col)?.loc ?? STOCK;
}

/** The cursor after one arrow key. At the edge of the table the cursor
 *  stays where it is. */
export function moveCursor(game: Klondike, from: Cursor, dir: Direction): Cursor {
  const c = clampCursor(game, from);
  if (c.loc.kind === "tableau") {
    const col = c.loc.pile;
    switch (dir) {
      case "left":
      case "right": {
        const next = clamp(col + (dir === "left" ? -1 : 1), 0, COLUMNS - 1);
        return next === col ? c : topOf(game, { kind: "tableau", pile: next });
      }
      case "up":
        if (c.index > lowest(game, c.loc)) return { loc: c.loc, index: c.index - 1 };
        return topOf(game, aboveColumn(col));
      case "down":
        return c.index < game.pile(c.loc).length - 1 ? { loc: c.loc, index: c.index + 1 } : c;
    }
  }
  const at = TOP_ROW.findIndex((e) => sameLoc(e.loc, c.loc));
  switch (dir) {
    case "left":
    case "right": {
      const next = clamp(at + (dir === "left" ? -1 : 1), 0, TOP_ROW.length - 1);
      const entry = TOP_ROW[next];
      return next === at || !entry ? c : topOf(game, entry.loc);
    }
    case "up":
      return c;
    case "down":
      return topOf(game, { kind: "tableau", pile: TOP_ROW[at]?.col ?? 0 });
  }
}

/** What Enter does at cursor `c` while the player holds the run that
 *  starts at `held`, or holds nothing when `held` is null. */
export function cursorAction(game: Klondike, c: Cursor, held: Cursor | null): CursorAction {
  if (held) {
    const run = game.runAt(held.loc, held.index);
    if (!run) return { type: "drop", run: [] };
    if (sameLoc(held.loc, c.loc)) return { type: "drop", run };
    return { type: "place", run, from: held, to: c.loc, fits: game.canDrop(run, c.loc) };
  }
  if (c.loc.kind === "stock") return { type: "draw" };
  const run = game.runAt(c.loc, c.index);
  return run ? { type: "hold", run } : { type: "none" };
}
