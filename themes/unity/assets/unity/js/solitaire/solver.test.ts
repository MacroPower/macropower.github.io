// Solver suite: solutions must replay through the real rules to a win,
// and enough random deals must solve inside the budget for the demo's
// redeal loop to converge quickly.

import { describe, expect, it } from "vitest";
import { Klondike, type Card, type Suit } from "./klondike";
import { replay, SOLVE_BUDGET, solve } from "./solver";

// solve() searches in the same order under every budget, and a smaller
// budget stops the search sooner. So for every deal that solve() solves
// under SAMPLE_BUDGET, it finds the same moves under the demo's
// SOLVE_BUDGET. The sample's solve rate then bounds the demo's from
// below. Each deal that solve() fails costs the whole budget, so the
// small budget keeps the test fast.
const SAMPLE_BUDGET = 1_000;

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

describe("solve", () => {
  it("finishes a finished tableau in 52 foundation plays", () => {
    const g = new Klondike(1, seeded(3));
    g.stock = [];
    g.waste = [];
    g.tableau = [[], [], [], [], [], [], []];
    for (let suit = 0; suit < 4; suit++) {
      for (let rank = 13; rank >= 1; rank--) g.tableau[suit]!.push(card(suit as Suit, rank));
    }
    const moves = solve(g);
    expect(moves).not.toBeNull();
    expect(moves).toHaveLength(52);
    expect(moves!.every((m) => m.to.kind === "foundation")).toBe(true);
    expect(replay(g, moves!)).toBe(true);
  });

  it("does not touch the deal it searches", () => {
    const g = new Klondike(1, seeded(11));
    const before = JSON.stringify([g.stock, g.waste, g.foundations, g.tableau]);
    solve(g);
    expect(JSON.stringify([g.stock, g.waste, g.foundations, g.tableau])).toBe(before);
  });

  it("solves a quarter of random deals in a small budget, and every solution replays to a win", () => {
    expect(SAMPLE_BUDGET).toBeLessThan(SOLVE_BUDGET);
    let solved = 0;
    const deals = 24;
    for (let seed = 1; seed <= deals; seed++) {
      const g = new Klondike(1, seeded(seed * 7919));
      const moves = solve(g, SAMPLE_BUDGET);
      if (!moves) continue;
      solved++;
      expect(solve(g)).toEqual(moves);
      expect(replay(g, moves)).toBe(true);
    }
    expect(solved).toBeGreaterThanOrEqual(deals / 4);
  });

  // The searches that solve the sample's deals undo few steps and none
  // that turned a card face up. The search for each of these two deals
  // undoes thousands of steps, some of which turned a card face up,
  // before it finds a solution.
  it("replays a solution found after a long search", () => {
    for (const seed of [18, 20]) {
      const g = new Klondike(1, seeded(seed * 7919));
      expect(solve(g, SAMPLE_BUDGET)).toBeNull();
      const moves = solve(g);
      expect(moves).not.toBeNull();
      expect(replay(g, moves!)).toBe(true);
    }
  });

  it("gives up cleanly when the budget is tiny", () => {
    const g = new Klondike(1, seeded(5));
    expect(solve(g, 5)).toBeNull();
  });
});
