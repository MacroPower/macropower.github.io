// Klondike solitaire, the rules only. This module knows nothing about the
// DOM, the canvas, or timing: it holds the piles, validates and applies
// moves, records an undo trail, and answers the questions the renderer asks
// (hints, auto-complete, win). Everything visual lives in index.ts, so the
// rules run headless under Vitest (klondike.test.ts).
//
// Foundations are pinned to suits (foundation i takes suit i, hearts through
// spades), which keeps the empty slots legible: each one shows the pip it
// wants. Scoring follows the classic Windows table (5 for a waste-to-tableau
// play or a tableau flip, 10 for a card reaching a foundation, minus 15 for
// taking one back down), floored at zero.

/** 0 hearts, 1 diamonds, 2 clubs, 3 spades. */
export type Suit = 0 | 1 | 2 | 3;

export interface Card {
  /** Stable identity, 0..51: suit * 13 + rank - 1. */
  id: number;
  suit: Suit;
  /** 1 (ace) through 13 (king). */
  rank: number;
  faceUp: boolean;
}

export type PileKind = "stock" | "waste" | "foundation" | "tableau";

/** A pile address. `pile` is the foundation (0..3) or tableau column (0..6)
 *  index and is 0 for the stock and waste. */
export interface Loc {
  kind: PileKind;
  pile: number;
}

export interface MoveRecord {
  type: "move";
  from: Loc;
  to: Loc;
  /** Cards moved, from the top of the source run. */
  count: number;
  /** Whether the move exposed a face-down tableau card beneath the run. */
  flipped: boolean;
  /** Score delta applied (already floored). */
  score: number;
}

export interface DrawRecord {
  type: "draw";
  /** Cards turned from the stock onto the waste. */
  count: number;
}

export interface RecycleRecord {
  type: "recycle";
  /** Cards returned from the waste to the stock. */
  count: number;
}

export type HistoryRecord = MoveRecord | DrawRecord | RecycleRecord;

/** One suggested play: a run to drag (`from`/`index`) and where it goes, or
 *  a plain stock draw when nothing else is available. */
export type Hint =
  | { type: "move"; from: Loc; index: number; to: Loc }
  | { type: "draw" };

export const RANK_LABELS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUIT_NAMES = ["hearts", "diamonds", "clubs", "spades"] as const;

export function isRed(suit: Suit): boolean {
  return suit < 2;
}

export function cardName(card: Card): string {
  return `${RANK_LABELS[card.rank]} of ${SUIT_NAMES[card.suit]}`;
}

export function sameLoc(a: Loc, b: Loc): boolean {
  return a.kind === b.kind && a.pile === b.pile;
}

export type Rng = () => number;

function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (let suit = 0; suit < 4; suit++) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({ id: suit * 13 + rank - 1, suit: suit as Suit, rank, faceUp: false });
    }
  }
  return deck;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export class Klondike {
  stock: Card[] = [];
  waste: Card[] = [];
  foundations: Card[][] = [[], [], [], []];
  tableau: Card[][] = [[], [], [], [], [], [], []];
  drawCount: 1 | 3;
  score = 0;
  moves = 0;
  history: HistoryRecord[] = [];

  constructor(drawCount: 1 | 3 = 1, rng: Rng = Math.random) {
    this.drawCount = drawCount;
    const deck = shuffle(makeDeck(), rng);
    // Deal left to right, one row at a time, so column c holds c+1 cards
    // with only the last face up.
    for (let row = 0; row < 7; row++) {
      for (let col = row; col < 7; col++) {
        const card = deck.pop()!;
        card.faceUp = col === row;
        this.tableau[col].push(card);
      }
    }
    this.stock = deck;
  }

  pile(loc: Loc): Card[] {
    switch (loc.kind) {
      case "stock": return this.stock;
      case "waste": return this.waste;
      case "foundation": return this.foundations[loc.pile];
      case "tableau": return this.tableau[loc.pile];
    }
  }

  /** Every card in play, in no particular order. */
  cards(): Card[] {
    return [...this.stock, ...this.waste, ...this.foundations.flat(), ...this.tableau.flat()];
  }

  /** The run a player may pick up starting at `index` of `from`, or null
   *  when that card cannot be moved (face down, buried in the waste, ...). */
  runAt(from: Loc, index: number): Card[] | null {
    const pile = this.pile(from);
    if (index < 0 || index >= pile.length) return null;
    switch (from.kind) {
      case "stock":
        return null;
      case "waste":
      case "foundation":
        return index === pile.length - 1 ? [pile[index]] : null;
      case "tableau":
        // Face-up tableau cards always form a valid run down to the top of
        // the column (nothing else can be placed there), so any face-up card
        // starts a movable run.
        return pile[index].faceUp ? pile.slice(index) : null;
    }
  }

  canDrop(run: Card[], to: Loc): boolean {
    if (run.length === 0) return false;
    const lead = run[0];
    const dest = this.pile(to);
    switch (to.kind) {
      case "foundation":
        return run.length === 1 && lead.suit === to.pile && lead.rank === dest.length + 1;
      case "tableau": {
        if (dest.length === 0) return lead.rank === 13;
        const top = dest[dest.length - 1];
        return top.faceUp && top.rank === lead.rank + 1 && isRed(top.suit) !== isRed(lead.suit);
      }
      default:
        return false;
    }
  }

  /** Move the run starting at `index` of `from` onto `to`. Returns the
   *  history record, or null when the move is illegal. */
  move(from: Loc, index: number, to: Loc): MoveRecord | null {
    if (sameLoc(from, to)) return null;
    const run = this.runAt(from, index);
    if (!run || !this.canDrop(run, to)) return null;
    const src = this.pile(from);
    const dest = this.pile(to);
    dest.push(...src.splice(index, run.length));

    let flipped = false;
    if (from.kind === "tableau" && src.length > 0 && !src[src.length - 1].faceUp) {
      src[src.length - 1].faceUp = true;
      flipped = true;
    }

    let delta = 0;
    if (to.kind === "foundation") delta += 10;
    else if (from.kind === "waste") delta += 5;
    else if (from.kind === "foundation") delta -= 15;
    if (flipped) delta += 5;
    const applied = this.applyScore(delta);

    this.moves++;
    const record: MoveRecord = { type: "move", from, to, count: run.length, flipped, score: applied };
    this.history.push(record);
    return record;
  }

  /** Turn the next card(s) from the stock, or recycle the waste when the
   *  stock is empty. Returns null when both are empty. */
  draw(): DrawRecord | RecycleRecord | null {
    if (this.stock.length > 0) {
      const count = Math.min(this.drawCount, this.stock.length);
      for (let i = 0; i < count; i++) {
        const card = this.stock.pop()!;
        card.faceUp = true;
        this.waste.push(card);
      }
      this.moves++;
      const record: DrawRecord = { type: "draw", count };
      this.history.push(record);
      return record;
    }
    if (this.waste.length > 0) {
      const count = this.waste.length;
      while (this.waste.length > 0) {
        const card = this.waste.pop()!;
        card.faceUp = false;
        this.stock.push(card);
      }
      this.moves++;
      const record: RecycleRecord = { type: "recycle", count };
      this.history.push(record);
      return record;
    }
    return null;
  }

  /** Reverse the last play. Returns the record undone, or null. */
  undo(): HistoryRecord | null {
    const record = this.history.pop();
    if (!record) return null;
    switch (record.type) {
      case "move": {
        const src = this.pile(record.from);
        const dest = this.pile(record.to);
        if (record.flipped) src[src.length - 1].faceUp = false;
        src.push(...dest.splice(dest.length - record.count, record.count));
        this.score = Math.max(0, this.score - record.score);
        break;
      }
      case "draw":
        for (let i = 0; i < record.count; i++) {
          const card = this.waste.pop()!;
          card.faceUp = false;
          this.stock.push(card);
        }
        break;
      case "recycle":
        for (let i = 0; i < record.count; i++) {
          const card = this.stock.pop()!;
          card.faceUp = true;
          this.waste.push(card);
        }
        break;
    }
    this.moves = Math.max(0, this.moves - 1);
    return record;
  }

  won(): boolean {
    return this.foundations.every((f) => f.length === 13);
  }

  /** Where a click on `index` of `from` should send the run: its foundation
   *  when the single card fits, otherwise the first tableau column that
   *  takes it. Whole-column moves of a king onto another empty column are
   *  skipped as pointless. */
  autoTarget(from: Loc, index: number): Loc | null {
    const run = this.runAt(from, index);
    if (!run) return null;
    if (run.length === 1) {
      const to: Loc = { kind: "foundation", pile: run[0].suit };
      if (this.canDrop(run, to)) return to;
    }
    const kingAtBase = from.kind === "tableau" && index === 0 && run[0].rank === 13;
    for (let col = 0; col < 7; col++) {
      const to: Loc = { kind: "tableau", pile: col };
      if (sameLoc(from, to)) continue;
      if (kingAtBase && this.tableau[col].length === 0) continue;
      if (this.canDrop(run, to)) return to;
    }
    return null;
  }

  /** Useful plays, best first: cards to the foundations, then tableau moves
   *  that expose a face-down card or free a column, then waste plays, and
   *  finally a stock draw. Never suggests shuffling a run between two
   *  columns for nothing. */
  hints(): Hint[] {
    const hints: Hint[] = [];
    const foundations: Hint[] = [];
    const tableauMoves: Hint[] = [];
    const wasteMoves: Hint[] = [];

    // Tableau tops and the waste top to the foundations.
    const tops: { from: Loc; index: number }[] = [];
    for (let col = 0; col < 7; col++) {
      if (this.tableau[col].length > 0) {
        tops.push({ from: { kind: "tableau", pile: col }, index: this.tableau[col].length - 1 });
      }
    }
    if (this.waste.length > 0) tops.push({ from: { kind: "waste", pile: 0 }, index: this.waste.length - 1 });
    for (const src of tops) {
      const run = this.runAt(src.from, src.index);
      if (!run) continue;
      const to: Loc = { kind: "foundation", pile: run[0].suit };
      if (this.canDrop(run, to)) foundations.push({ type: "move", from: src.from, index: src.index, to });
    }

    // Tableau runs to other columns.
    for (let col = 0; col < 7; col++) {
      const column = this.tableau[col];
      const first = column.findIndex((c) => c.faceUp);
      if (first < 0) continue;
      for (let index = first; index < column.length; index++) {
        const run = column.slice(index);
        const from: Loc = { kind: "tableau", pile: col };
        // Moving the base king of a column elsewhere frees nothing.
        if (index === 0 && run[0].rank === 13) continue;
        // Splitting a face-up run only helps when it uncovers a card.
        if (index > first) continue;
        for (let dest = 0; dest < 7; dest++) {
          if (dest === col) continue;
          const to: Loc = { kind: "tableau", pile: dest };
          if (this.canDrop(run, to)) tableauMoves.push({ type: "move", from, index, to });
        }
      }
    }

    if (this.waste.length > 0) {
      const from: Loc = { kind: "waste", pile: 0 };
      const index = this.waste.length - 1;
      const run = this.runAt(from, index)!;
      for (let dest = 0; dest < 7; dest++) {
        const to: Loc = { kind: "tableau", pile: dest };
        if (this.canDrop(run, to)) wasteMoves.push({ type: "move", from, index, to });
      }
    }

    hints.push(...foundations, ...tableauMoves, ...wasteMoves);
    if (this.stock.length > 0 || this.waste.length > 0) hints.push({ type: "draw" });
    return hints;
  }

  /** True once every remaining card is face up on the tableau: from here
   *  the game plays itself out to the foundations. */
  autoCompleteAvailable(): boolean {
    if (this.won()) return false;
    if (this.stock.length > 0 || this.waste.length > 0) return false;
    return this.tableau.every((col) => col.every((c) => c.faceUp));
  }

  /** Play the lowest-ranked available top card to its foundation. Returns
   *  the move made, or null when nothing fits. */
  autoStep(): MoveRecord | null {
    let best: { from: Loc; index: number; rank: number } | null = null;
    const consider = (from: Loc): void => {
      const pile = this.pile(from);
      if (pile.length === 0) return;
      const index = pile.length - 1;
      const run = this.runAt(from, index);
      if (!run) return;
      const card = run[0];
      if (!this.canDrop(run, { kind: "foundation", pile: card.suit })) return;
      if (!best || card.rank < best.rank) best = { from, index, rank: card.rank };
    };
    for (let col = 0; col < 7; col++) consider({ kind: "tableau", pile: col });
    consider({ kind: "waste", pile: 0 });
    if (!best) return null;
    const chosen: { from: Loc; index: number; rank: number } = best;
    const card = this.pile(chosen.from)[chosen.index];
    return this.move(chosen.from, chosen.index, { kind: "foundation", pile: card.suit });
  }

  private applyScore(delta: number): number {
    const before = this.score;
    this.score = Math.max(0, this.score + delta);
    return this.score - before;
  }
}
