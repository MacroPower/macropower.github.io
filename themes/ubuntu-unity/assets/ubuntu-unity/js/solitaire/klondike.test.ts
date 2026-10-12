// Rules suite for klondike.ts. Deals come from a seeded generator so every
// assertion is reproducible; the "rigged" helper builds a game by hand for
// the rules that need a specific board.

import { describe, expect, it } from "vitest";
import { Klondike, isRed, type Card, type Loc, type Suit } from "./klondike";

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function card(suit: Suit, rank: number, faceUp = true): Card {
  return { id: suit * 13 + rank - 1, suit, rank, faceUp };
}

/** A game with every pile emptied, ready for a hand-built position. */
function rigged(drawCount: 1 | 3 = 1): Klondike {
  const g = new Klondike(drawCount, seeded(1));
  g.stock = [];
  g.waste = [];
  g.foundations = [[], [], [], []];
  g.tableau = [[], [], [], [], [], [], []];
  g.score = 0;
  g.moves = 0;
  g.history = [];
  return g;
}

const T = (pile: number): Loc => ({ kind: "tableau", pile });
const F = (pile: number): Loc => ({ kind: "foundation", pile });
const W: Loc = { kind: "waste", pile: 0 };

describe("deal", () => {
  it("lays out 52 unique cards with 1..7 per column and only the tops face up", () => {
    const g = new Klondike(1, seeded(7));
    const ids = g.cards().map((c) => c.id).sort((a, b) => a - b);
    expect(ids).toEqual(Array.from({ length: 52 }, (_, i) => i));
    expect(g.stock).toHaveLength(24);
    expect(g.waste).toHaveLength(0);
    g.tableau.forEach((col, i) => {
      expect(col).toHaveLength(i + 1);
      col.forEach((c, j) => expect(c.faceUp).toBe(j === i));
    });
    expect(g.stock.every((c) => !c.faceUp)).toBe(true);
  });

  it("is deterministic for a given generator", () => {
    const a = new Klondike(1, seeded(42)).cards().map((c) => c.id);
    const b = new Klondike(1, seeded(42)).cards().map((c) => c.id);
    expect(a).toEqual(b);
  });
});

describe("runAt", () => {
  it("only offers face-up tableau cards, and the whole run below them", () => {
    const g = rigged();
    g.tableau[0] = [card(3, 9, false), card(0, 8), card(2, 7), card(1, 6)];
    expect(g.runAt(T(0), 0)).toBeNull();
    expect(g.runAt(T(0), 1)?.map((c) => c.rank)).toEqual([8, 7, 6]);
    expect(g.runAt(T(0), 3)?.map((c) => c.rank)).toEqual([6]);
    expect(g.runAt(T(0), 4)).toBeNull();
  });

  it("offers only the top of the waste and never the stock", () => {
    const g = rigged();
    g.waste = [card(0, 2), card(1, 5)];
    g.stock = [card(2, 3, false)];
    expect(g.runAt(W, 0)).toBeNull();
    expect(g.runAt(W, 1)).toHaveLength(1);
    expect(g.runAt({ kind: "stock", pile: 0 }, 0)).toBeNull();
  });
});

describe("canDrop", () => {
  it("builds tableau columns down in alternating colors", () => {
    const g = rigged();
    g.tableau[0] = [card(0, 8)];
    expect(g.canDrop([card(2, 7)], T(0))).toBe(true);
    expect(g.canDrop([card(1, 7)], T(0))).toBe(false);
    expect(g.canDrop([card(2, 6)], T(0))).toBe(false);
    expect(g.canDrop([card(2, 7), card(0, 6)], T(0))).toBe(true);
  });

  it("only lets kings start an empty column", () => {
    const g = rigged();
    expect(g.canDrop([card(3, 13)], T(2))).toBe(true);
    expect(g.canDrop([card(3, 12)], T(2))).toBe(false);
  });

  it("refuses a face-down tableau top", () => {
    const g = rigged();
    g.tableau[0] = [card(0, 8, false)];
    expect(g.canDrop([card(2, 7)], T(0))).toBe(false);
  });

  it("builds foundations up by suit from the ace, one card at a time", () => {
    const g = rigged();
    expect(g.canDrop([card(2, 1)], F(2))).toBe(true);
    expect(g.canDrop([card(2, 1)], F(3))).toBe(false);
    expect(g.canDrop([card(2, 2)], F(2))).toBe(false);
    g.foundations[2] = [card(2, 1)];
    expect(g.canDrop([card(2, 2)], F(2))).toBe(true);
    expect(g.canDrop([card(2, 2), card(0, 1)], F(2))).toBe(false);
  });

  it("never drops onto the stock or waste", () => {
    const g = rigged();
    expect(g.canDrop([card(0, 1)], W)).toBe(false);
    expect(g.canDrop([card(0, 1)], { kind: "stock", pile: 0 })).toBe(false);
  });
});

describe("move", () => {
  it("moves a run, flips the exposed card, and scores the flip", () => {
    const g = rigged();
    g.tableau[0] = [card(3, 9, false), card(0, 8), card(2, 7)];
    g.tableau[1] = [card(3, 9)];
    const record = g.move(T(0), 1, T(1));
    expect(record).toMatchObject({ type: "move", count: 2, flipped: true, score: 5 });
    expect(g.tableau[1].map((c) => c.rank)).toEqual([9, 8, 7]);
    expect(g.tableau[0]).toHaveLength(1);
    expect(g.tableau[0][0].faceUp).toBe(true);
    expect(g.score).toBe(5);
    expect(g.moves).toBe(1);
  });

  it("scores waste plays and foundation plays, and floors the score at zero", () => {
    const g = rigged();
    g.waste = [card(0, 1)];
    g.tableau[0] = [card(2, 2)];
    expect(g.move(W, 0, T(0))?.score).toBe(5);
    expect(g.move(T(0), 1, F(0))?.score).toBe(10);
    expect(g.score).toBe(15);
    expect(g.move(F(0), 0, T(0))?.score).toBe(-15);
    expect(g.score).toBe(0);
    expect(g.move(T(0), 1, F(0))?.score).toBe(10);
    expect(g.move(F(0), 0, T(0))?.score).toBe(-10);
    expect(g.score).toBe(0);
  });

  it("rejects illegal moves without touching the state", () => {
    const g = rigged();
    g.tableau[0] = [card(0, 8)];
    g.tableau[1] = [card(1, 5)];
    expect(g.move(T(0), 0, T(1))).toBeNull();
    expect(g.move(T(0), 0, T(0))).toBeNull();
    expect(g.tableau[0]).toHaveLength(1);
    expect(g.tableau[1]).toHaveLength(1);
    expect(g.moves).toBe(0);
    expect(g.history).toHaveLength(0);
  });
});

describe("draw and recycle", () => {
  it("turns drawCount cards face up onto the waste, fewer at the end", () => {
    const g = rigged(3);
    g.stock = [card(0, 1, false), card(0, 2, false), card(0, 3, false), card(0, 4, false)];
    expect(g.draw()).toEqual({ type: "draw", count: 3 });
    expect(g.waste.map((c) => c.rank)).toEqual([4, 3, 2]);
    expect(g.waste.every((c) => c.faceUp)).toBe(true);
    expect(g.draw()).toEqual({ type: "draw", count: 1 });
    expect(g.stock).toHaveLength(0);
  });

  it("recycles the waste back into the stock in order, and reports nothing when both are empty", () => {
    const g = rigged(1);
    g.stock = [card(0, 1, false), card(0, 2, false)];
    g.draw();
    g.draw();
    expect(g.draw()).toEqual({ type: "recycle", count: 2 });
    expect(g.stock.map((c) => c.rank)).toEqual([1, 2]);
    expect(g.stock.every((c) => !c.faceUp)).toBe(true);
    expect(g.waste).toHaveLength(0);
    g.stock = [];
    expect(g.draw()).toBeNull();
  });
});

describe("undo", () => {
  it("reverses moves, flips, score, and the move counter", () => {
    const g = rigged();
    g.tableau[0] = [card(3, 9, false), card(0, 8)];
    g.tableau[1] = [card(3, 9)];
    const before = JSON.stringify([g.tableau, g.score, g.moves]);
    g.move(T(0), 1, T(1));
    expect(g.undo()?.type).toBe("move");
    expect(JSON.stringify([g.tableau, g.score, g.moves])).toBe(before);
    expect(g.tableau[0][0].faceUp).toBe(false);
    expect(g.undo()).toBeNull();
  });

  it("reverses draws and recycles", () => {
    const g = rigged(3);
    g.stock = [card(0, 1, false), card(0, 2, false), card(0, 3, false)];
    const fresh = JSON.stringify([g.stock, g.waste]);
    g.draw();
    const drawn = JSON.stringify([g.stock, g.waste]);
    g.draw(); // recycle
    expect(g.undo()?.type).toBe("recycle");
    expect(JSON.stringify([g.stock, g.waste])).toBe(drawn);
    expect(g.undo()?.type).toBe("draw");
    expect(JSON.stringify([g.stock, g.waste])).toBe(fresh);
    expect(g.moves).toBe(0);
  });
});

describe("autoTarget", () => {
  it("prefers the foundation, then the first fitting column, and skips pointless king shuffles", () => {
    const g = rigged();
    g.tableau[0] = [card(0, 1)];
    expect(g.autoTarget(T(0), 0)).toEqual(F(0));
    g.tableau[0] = [card(0, 7)];
    g.tableau[3] = [card(2, 8)];
    g.tableau[5] = [card(3, 8)];
    expect(g.autoTarget(T(0), 0)).toEqual(T(3));
    g.tableau[0] = [card(0, 13)];
    expect(g.autoTarget(T(0), 0)).toBeNull();
    g.tableau[0] = [card(1, 2, false), card(0, 13)];
    expect(g.autoTarget(T(0), 1)).toEqual(T(1));
  });
});

describe("hints", () => {
  it("ranks foundation plays first and ends with a draw while cards remain", () => {
    const g = rigged();
    g.stock = [card(3, 5, false)];
    g.tableau[0] = [card(2, 1)];
    g.tableau[1] = [card(0, 9, false), card(3, 7)];
    g.tableau[2] = [card(0, 8)];
    const hints = g.hints();
    expect(hints[0]).toEqual({ type: "move", from: T(0), index: 0, to: F(2) });
    expect(hints[1]).toEqual({ type: "move", from: T(1), index: 1, to: T(2) });
    expect(hints[hints.length - 1]).toEqual({ type: "draw" });
  });

  it("never suggests moving a base king or splitting a face-up run", () => {
    const g = rigged();
    g.tableau[0] = [card(3, 13), card(0, 12), card(2, 11)];
    g.tableau[1] = [card(1, 12)];
    const moves = g.hints().filter((h) => h.type === "move");
    expect(moves).toHaveLength(0);
  });
});

describe("auto-complete and win", () => {
  it("is available only with an empty stock and waste and every card face up", () => {
    const g = rigged();
    g.tableau[0] = [card(0, 2, false), card(0, 1)];
    expect(g.autoCompleteAvailable()).toBe(false);
    g.tableau[0][0].faceUp = true;
    expect(g.autoCompleteAvailable()).toBe(true);
    g.stock = [card(3, 3, false)];
    expect(g.autoCompleteAvailable()).toBe(false);
  });

  it("steps the lowest available card to its foundation until the game is won", () => {
    const g = rigged();
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 13; rank >= 1; rank--) {
        g.tableau[suit].push(card(suit as Suit, rank));
      }
    }
    expect(g.autoCompleteAvailable()).toBe(true);
    let steps = 0;
    while (g.autoStep()) steps++;
    expect(steps).toBe(52);
    expect(g.won()).toBe(true);
    expect(g.autoCompleteAvailable()).toBe(false);
    expect(g.score).toBe(520);
  });
});

describe("colors", () => {
  it("treats hearts and diamonds as red", () => {
    expect([0, 1, 2, 3].map((s) => isRed(s as Suit))).toEqual([true, true, false, false]);
  });
});
