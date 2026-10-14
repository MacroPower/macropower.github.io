// Drives the keyboard cursor through one hand-built table. Column 1 holds
// a face-down 3 of clubs under the 9 of hearts and the 8 of spades, the
// waste holds the ace of hearts, and the stock holds one card.

import { describe, expect, it } from "vitest";

import { clampCursor, cursorAction, moveCursor, startCursor, topOf, type Cursor, type Direction } from "./cursor";
import { Klondike, type Card, type Loc, type Suit } from "./klondike";

function card(suit: Suit, rank: number, faceUp = true): Card {
  return { id: suit * 13 + rank - 1, suit, rank, faceUp };
}

function table(): Klondike {
  const g = new Klondike(1, () => 0);
  g.stock = [card(2, 2, false)];
  g.waste = [card(0, 1)];
  g.foundations = [[], [], [], []];
  g.tableau = [
    [],
    [card(2, 3, false), card(0, 9), card(3, 8)],
    [card(1, 5)],
    [card(3, 10)],
    [],
    [],
    [],
  ];
  g.score = 0;
  g.moves = 0;
  g.history = [];
  return g;
}

const T = (pile: number): Loc => ({ kind: "tableau", pile });
const F = (pile: number): Loc => ({ kind: "foundation", pile });
const STOCK: Loc = { kind: "stock", pile: 0 };
const WASTE: Loc = { kind: "waste", pile: 0 };

function at(loc: Loc, index: number): Cursor {
  return { loc, index };
}

function steer(g: Klondike, from: Cursor, ...dirs: Direction[]): Cursor {
  return dirs.reduce((c, dir) => moveCursor(g, c, dir), from);
}

describe("moveCursor", () => {
  it("starts on the stock", () => {
    expect(startCursor(table())).toEqual(at(STOCK, 0));
  });

  it("steps along the top row past the gap over column 2, and stops at its ends", () => {
    const g = table();
    const start = startCursor(g);
    expect(steer(g, start, "left")).toEqual(start);
    expect(steer(g, start, "up")).toEqual(start);
    expect(steer(g, start, "right")).toEqual(at(WASTE, 0));
    expect(steer(g, start, "right", "right")).toEqual(at(F(0), 0));
    expect(steer(g, start, "right", "right", "right", "right", "right")).toEqual(at(F(3), 0));
    expect(steer(g, at(F(3), 0), "right")).toEqual(at(F(3), 0));
    expect(steer(g, at(F(0), 0), "left")).toEqual(at(WASTE, 0));
  });

  it("goes down from each top pile to the top card of the column under it", () => {
    const g = table();
    expect(steer(g, at(STOCK, 0), "down")).toEqual(at(T(0), 0));
    expect(steer(g, at(WASTE, 0), "down")).toEqual(at(T(1), 2));
    expect(steer(g, at(F(0), 0), "down")).toEqual(at(T(3), 0));
    expect(steer(g, at(F(3), 0), "down")).toEqual(at(T(6), 0));
  });

  it("lands on the top card of each column it steps to, and stops at the outer columns", () => {
    const g = table();
    expect(steer(g, at(T(1), 1), "right")).toEqual(at(T(2), 0));
    expect(steer(g, at(T(2), 0), "left")).toEqual(at(T(1), 2));
    expect(steer(g, at(T(0), 0), "left")).toEqual(at(T(0), 0));
    expect(steer(g, at(T(6), 0), "right")).toEqual(at(T(6), 0));
  });

  it("walks up a column's face-up cards, then crosses to the pile above", () => {
    const g = table();
    expect(steer(g, at(T(1), 2), "up")).toEqual(at(T(1), 1));
    expect(steer(g, at(T(1), 2), "up", "up")).toEqual(at(WASTE, 0));
    expect(steer(g, at(T(0), 0), "up")).toEqual(at(STOCK, 0));
    expect(steer(g, at(T(2), 0), "up")).toEqual(at(WASTE, 0));
    expect(steer(g, at(T(3), 0), "up")).toEqual(at(F(0), 0));
    expect(steer(g, at(T(6), 0), "up")).toEqual(at(F(3), 0));
  });

  it("walks down to a column's top card and stops there", () => {
    const g = table();
    expect(steer(g, at(T(1), 1), "down")).toEqual(at(T(1), 2));
    expect(steer(g, at(T(1), 2), "down")).toEqual(at(T(1), 2));
    expect(steer(g, at(T(0), 0), "down")).toEqual(at(T(0), 0));
  });
});

describe("clampCursor", () => {
  it("follows the piles when a move, a draw, or an undo changes them", () => {
    const g = table();
    expect(g.move(T(1), 1, T(3))).not.toBeNull();
    // Column 1 is down to the 3 of clubs, which the move turned face up.
    expect(clampCursor(g, at(T(1), 2))).toEqual(at(T(1), 0));
    expect(g.undo()).not.toBeNull();
    // The undo turned the 3 of clubs face down again.
    expect(clampCursor(g, at(T(1), 0))).toEqual(at(T(1), 1));
    expect(g.draw()).not.toBeNull();
    expect(clampCursor(g, at(WASTE, 0))).toEqual(at(WASTE, 1));
    expect(clampCursor(g, at(STOCK, 0))).toEqual(at(STOCK, 0));
  });

  it("keeps a face-up card the cursor already names", () => {
    const g = table();
    expect(clampCursor(g, at(T(1), 1))).toEqual(at(T(1), 1));
    expect(topOf(g, T(1))).toEqual(at(T(1), 2));
  });
});

describe("cursorAction", () => {
  it("draws on the stock and holds the run under the cursor elsewhere", () => {
    const g = table();
    expect(cursorAction(g, at(STOCK, 0), null)).toEqual({ type: "draw" });
    expect(cursorAction(g, at(T(1), 1), null)).toEqual({ type: "hold", run: [card(0, 9), card(3, 8)] });
    expect(cursorAction(g, at(WASTE, 0), null)).toEqual({ type: "hold", run: [card(0, 1)] });
    expect(cursorAction(g, at(T(0), 0), null)).toEqual({ type: "none" });
    expect(cursorAction(g, at(F(0), 0), null)).toEqual({ type: "none" });
  });

  it("places a held run on another pile and says whether it fits", () => {
    const g = table();
    const held = at(T(1), 1);
    const run = [card(0, 9), card(3, 8)];
    expect(cursorAction(g, at(T(3), 0), held)).toEqual({ type: "place", run, from: held, to: T(3), fits: true });
    expect(cursorAction(g, at(T(2), 0), held)).toEqual({ type: "place", run, from: held, to: T(2), fits: false });
    expect(cursorAction(g, at(F(0), 0), at(WASTE, 0))).toMatchObject({ type: "place", to: F(0), fits: true });
  });

  it("drops a held run when the cursor is back on its own pile", () => {
    const g = table();
    expect(cursorAction(g, at(T(1), 2), at(T(1), 1))).toEqual({ type: "drop", run: [card(0, 9), card(3, 8)] });
  });
});

describe("a keyboard play", () => {
  it("moves the 9 and 8 from column 1 onto the 10 of spades", () => {
    const g = table();
    let c = steer(g, startCursor(g), "down", "right", "up");
    expect(c).toEqual(at(T(1), 1));
    const hold = cursorAction(g, c, null);
    expect(hold.type).toBe("hold");
    const held = c;
    c = steer(g, c, "right", "right");
    const place = cursorAction(g, c, held);
    if (place.type !== "place") throw new Error(`expected a place, got ${place.type}`);
    expect(g.move(place.from.loc, place.from.index, place.to)).not.toBeNull();
    expect(g.tableau[3]).toEqual([card(3, 10), card(0, 9), card(3, 8)]);
    expect(clampCursor(g, c)).toEqual(at(T(3), 0));
    expect(topOf(g, T(3))).toEqual(at(T(3), 2));
  });
});
