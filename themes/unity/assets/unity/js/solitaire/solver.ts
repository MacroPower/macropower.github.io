// A Klondike solver for the `?rig=auto` demo: given a deal, find a
// sequence of plays that wins it, so the table can play a whole game
// unattended. DOM-free and covered by solver.test.ts.
//
// The search is "thoughtful" Klondike: every card is known, the rules are
// draw-one with unlimited passes through the stock, and foundation cards
// are never taken back down. Under those rules any card in the stock or
// waste can be surfaced by drawing, so the stock and waste collapse into
// one pool of playable cards and a stock play is simply "this card, from
// the pool". The replay (index.ts, or `replay` below for tests) turns that
// back into real draws until the card sits on top of the waste.
//
// Depth-first search with a visited set and a node budget. Move ordering
// does most of the work: a foundation play that can never be needed as a
// tableau base is forced (it is the only branch explored), then the rest
// of the foundation plays, then tableau moves that uncover a face-down
// card or clear a column, then plays from the pool, and finally the
// speculative run splits. Deals that blow the budget return null; the
// caller deals again.

import { isRed, itemAt, type Card, type Klondike, type Loc, type Suit } from "./klondike";

export interface SolverMove {
  /** The lead card of the run being played. */
  card: Card;
  /** "stock" means the card is anywhere in the stock or waste. */
  from: "stock" | "tableau";
  to: Loc;
}

interface Step {
  move: SolverMove;
  apply(): void;
  undo(): void;
}

const ABORT = new Error("solver budget exhausted");

export function solve(game: Klondike, maxNodes = 150000): SolverMove[] | null {
  const cols: Card[][] = game.tableau.map((c) => c.slice());
  const down: number[] = game.tableau.map((c) => c.filter((x) => !x.faceUp).length);
  const found: [number, number, number, number] = [0, 0, 0, 0];
  for (const [suit, f] of game.foundations.entries()) found[suit] = f.length;
  const pool: Card[] = [...game.stock, ...game.waste];
  const inPool = new Array<boolean>(52).fill(false);
  for (const c of pool) inPool[c.id] = true;
  const visited = new Set<string>();
  const path: SolverMove[] = [];
  let nodes = 0;

  const key = (): string =>
    `${cols.map((c, i) => `${down[i]}:${c.map((x) => x.id).join(",")}`).join("|")}#${found.join(",")}`;

  const canFound = (c: Card): boolean => found[c.suit] === c.rank - 1;

  // A card is safe to send up once neither opposite-color card one rank
  // below can still need it as a base.
  const safe = (c: Card): boolean => {
    if (c.rank <= 2) return true;
    const opp: [Suit, Suit] = isRed(c.suit) ? [2, 3] : [0, 1];
    return found[opp[0]] >= c.rank - 1 && found[opp[1]] >= c.rank - 1;
  };

  const canStack = (lead: Card, col: number): boolean => {
    const top = itemAt(cols, col).at(-1);
    if (!top) return lead.rank === 13;
    return top.rank === lead.rank + 1 && isRed(top.suit) !== isRed(lead.suit);
  };

  /** Expose the next card when a column's face-up run is fully gone. */
  const flipIfBare = (col: number): boolean => {
    const hidden = itemAt(down, col);
    if (hidden > 0 && itemAt(cols, col).length === hidden) {
      down[col] = hidden - 1;
      return true;
    }
    return false;
  };

  const tableauToFoundation = (col: number): Step => {
    const column = itemAt(cols, col);
    const card = itemAt(column, column.length - 1);
    let flipped = false;
    return {
      move: { card, from: "tableau", to: { kind: "foundation", pile: card.suit } },
      apply() { column.pop(); found[card.suit]++; flipped = flipIfBare(col); },
      undo() { if (flipped) down[col] = itemAt(down, col) + 1; found[card.suit]--; column.push(card); },
    };
  };

  const poolToFoundation = (card: Card): Step => ({
    move: { card, from: "stock", to: { kind: "foundation", pile: card.suit } },
    apply() { inPool[card.id] = false; found[card.suit]++; },
    undo() { found[card.suit]--; inPool[card.id] = true; },
  });

  const poolToTableau = (card: Card, col: number): Step => {
    const column = itemAt(cols, col);
    return {
      move: { card, from: "stock", to: { kind: "tableau", pile: col } },
      apply() { inPool[card.id] = false; column.push(card); },
      undo() { column.pop(); inPool[card.id] = true; },
    };
  };

  const tableauToTableau = (col: number, index: number, dest: number): Step => {
    const source = itemAt(cols, col);
    const target = itemAt(cols, dest);
    const card = itemAt(source, index);
    let run: Card[] = [];
    let flipped = false;
    return {
      move: { card, from: "tableau", to: { kind: "tableau", pile: dest } },
      apply() { run = source.splice(index); target.push(...run); flipped = flipIfBare(col); },
      undo() { if (flipped) down[col] = itemAt(down, col) + 1; target.splice(target.length - run.length); source.push(...run); },
    };
  };

  function candidates(): Step[] {
    const forced: Step[] = [];
    const foundations: Step[] = [];
    const uncovers: Step[] = [];
    const poolPlays: Step[] = [];
    const splits: Step[] = [];

    for (const [col, column] of cols.entries()) {
      const top = column.at(-1);
      if (top && canFound(top)) (safe(top) ? forced : foundations).push(tableauToFoundation(col));
    }
    for (const card of pool) {
      if (inPool[card.id] && canFound(card)) (safe(card) ? forced : foundations).push(poolToFoundation(card));
    }
    const [first] = forced;
    if (first) return [first];

    // The first empty column stands for all of them.
    const emptyCol = cols.findIndex((c) => c.length === 0);
    for (const [col, column] of cols.entries()) {
      const hidden = itemAt(down, col);
      for (let index = hidden; index < column.length; index++) {
        const lead = itemAt(column, index);
        // A king already at the base of a column has nowhere better to be.
        if (index === 0 && lead.rank === 13) continue;
        const useful = index === hidden && (hidden > 0 || index === 0);
        for (let dest = 0; dest < 7; dest++) {
          if (dest === col) continue;
          if (itemAt(cols, dest).length === 0 && dest !== emptyCol) continue;
          if (!canStack(lead, dest)) continue;
          (useful ? uncovers : splits).push(tableauToTableau(col, index, dest));
        }
      }
    }
    for (const card of pool) {
      if (!inPool[card.id]) continue;
      for (let dest = 0; dest < 7; dest++) {
        if (itemAt(cols, dest).length === 0 && dest !== emptyCol) continue;
        if (canStack(card, dest)) poolPlays.push(poolToTableau(card, dest));
      }
    }
    return [...foundations, ...uncovers, ...poolPlays, ...splits];
  }

  function dfs(): boolean {
    if (found.every((h) => h === 13)) return true;
    if (++nodes > maxNodes) throw ABORT;
    const k = key();
    if (visited.has(k)) return false;
    visited.add(k);
    for (const step of candidates()) {
      step.apply();
      path.push(step.move);
      if (dfs()) return true;
      path.pop();
      step.undo();
    }
    return false;
  }

  try {
    return dfs() ? path.slice() : null;
  } catch (e) {
    if (e === ABORT) return null;
    throw e;
  }
}

/** Where a solver move's card currently sits on the real table, or null
 *  when it is still buried in the stock or waste. */
export function locate(game: Klondike, move: SolverMove): { from: Loc; index: number } | null {
  if (move.from === "stock") {
    const top = game.waste[game.waste.length - 1];
    return top && top.id === move.card.id ? { from: { kind: "waste", pile: 0 }, index: game.waste.length - 1 } : null;
  }
  for (const [col, column] of game.tableau.entries()) {
    const index = column.indexOf(move.card);
    if (index >= 0) return { from: { kind: "tableau", pile: col }, index };
  }
  return null;
}

/** Play a solution through the real rules, drawing until each stock card
 *  surfaces. Returns false if any move is refused. */
export function replay(game: Klondike, moves: SolverMove[]): boolean {
  for (const move of moves) {
    let at = locate(game, move);
    let guard = 0;
    while (!at && move.from === "stock" && guard++ < 60) {
      if (!game.draw()) return false;
      at = locate(game, move);
    }
    if (!at) return false;
    if (!game.move(at.from, at.index, move.to)) return false;
  }
  return game.won();
}
