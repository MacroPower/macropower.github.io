// The solitaire table: everything between the Klondike rules (klondike.ts)
// and the screen. The whole game renders into a small offscreen canvas at
// its logical resolution and is then upscaled with nearest-neighbor sampling
// onto the visible canvas, so movement, rotation, and scaling all quantize
// to chunky pixels. Cards own a "view" position that springs toward the
// spot the layout assigns them, so every state change (a play, an undo, a
// draw, the deal) animates without special cases. Session-only: nothing is
// persisted, a reload deals a fresh game.
//
// DOM contract (page/solitaire.html): [data-solitaire] root with
// [data-sol-stage] (the sized area), [data-sol-canvas], [data-sol-live] (the
// aria-live status line), and [data-sol-action="<id>"] buttons that mirror
// the on-canvas controls for keyboard and screen-reader users.

import {
  Klondike, cardName, sameLoc, type Card, type Hint, type Loc, type Suit,
} from "./klondike";
import {
  CARD_H, CARD_W, PAL, cardBack, cardFace, ctx2d, drawIcon, drawText,
  makeCanvas, pxRoundRect, pxRoundOutline, renderFelt, slotSprite, textWidth, ICONS,
} from "./sprites";
import { Sfx } from "./sound";

const GAP = 4;
const TABLEAU_W = 7 * CARD_W + 6 * GAP;
const TOP_Y = 6;
const TABLEAU_Y = TOP_Y + CARD_H + 8;
const FAN_DOWN = 4;
const FAN_UP_MAX = 12;
const FAN_UP_MIN = 6;
const WASTE_FAN = 8;
const HUD_ROW = 20;
const MIN_W = TABLEAU_W + 8;
const MIN_H = TABLEAU_Y + FAN_DOWN * 6 + FAN_UP_MIN * 12 + CARD_H + HUD_ROW + 4;
const DRAG_THRESHOLD = 4;

const STOCK: Loc = { kind: "stock", pile: 0 };
const WASTE: Loc = { kind: "waste", pile: 0 };

interface View {
  x: number;
  y: number;
  /** Radians; only the dragged run and the hovered run tilt. */
  rot: number;
  /** Which side the card currently shows (lags the model during a flip). */
  faceUp: boolean;
}

interface Tween {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t0: number;
  dur: number;
  /** In-flight cards draw above the table in tween start order. */
  z: number;
  started: boolean;
  onStart?: () => void;
  onDone?: () => void;
}

interface Flip {
  id: number;
  t0: number;
  dur: number;
  to: boolean;
  swapped: boolean;
}

interface Placement {
  card: Card;
  x: number;
  y: number;
  loc: Loc;
  index: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface Popup {
  text: string;
  x: number;
  y: number;
  t0: number;
  color: string;
}

interface Press {
  placement: Placement;
  run: Card[];
  /** Per-card offset from the pointer at pickup. */
  offsets: { dx: number; dy: number }[];
  startX: number;
  startY: number;
  dragging: boolean;
}

interface Bouncer {
  card: Card;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface Button {
  id: string;
  label?: string;
  icon?: string;
  color: string;
  dark: string;
  x: number;
  y: number;
  w: number;
  h: number;
  enabled: boolean;
  pulse?: boolean;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutBack(t: number): number {
  const c1 = 0.9;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function reduceMotion(): boolean {
  return document.body.classList.contains("up-reduce-motion")
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

(() => {
  const rootEl = document.querySelector<HTMLElement>("[data-solitaire]");
  if (!rootEl) return;
  const stageEl = rootEl.querySelector<HTMLElement>("[data-sol-stage]");
  const canvasEl = rootEl.querySelector<HTMLCanvasElement>("[data-sol-canvas]");
  if (!stageEl || !canvasEl) return;
  // Re-bound as non-null so the hoisted function declarations below see
  // the narrowed types.
  const root: HTMLElement = rootEl;
  const stage: HTMLElement = stageEl;
  const canvas: HTMLCanvasElement = canvasEl;
  const live = root.querySelector<HTMLElement>("[data-sol-live]");

  const hi = ctx2d(canvas);
  const lo = makeCanvas(MIN_W, MIN_H);
  const loCtx = ctx2d(lo);
  const sfx = new Sfx();

  let W = MIN_W;
  let H = MIN_H;
  let hudRows = 1;
  let felt = renderFelt(W, H);

  let game = new Klondike(1);
  let drawMode: 1 | 3 = 1;
  const views: View[] = [];
  let placements: Placement[] = [];
  const placementById = new Map<number, Placement>();
  let tweens: Tween[] = [];
  let flips: Flip[] = [];
  let zCounter = 0;
  let particles: Particle[] = [];
  let popups: Popup[] = [];
  let press: Press | null = null;
  let hover: Placement | null = null;
  let hoverButton: string | null = null;
  let pressedButton: string | null = null;
  let dropTarget: Loc | null = null;
  let pointerX = 0;
  let lastAvailW = 0;
  let lastAvailH = 0;
  let lastFlipSound = 0;
  /** Snapshot of the cascade's trails, the backdrop for the win banner. */
  let trails: HTMLCanvasElement | null = null;
  let dragVel = 0;
  let hint: Hint | null = null;
  let hintCursor = 0;
  let hintT0 = 0;
  let startedAt = 0;
  let frozenElapsed = 0;
  let scoreShown = 0;
  let scoreShake = 0;
  let autoRunning = false;
  let autoTimer = 0;
  let won = false;
  let bouncers: Bouncer[] = [];
  let cascadeQueue: Card[] = [];
  let cascadeNext = 0;
  let winT0 = 0;
  let banner = false;
  let dealing = false;
  let buttons: Button[] = [];
  let frameQueued = false;
  let lastFrame = performance.now();

  // ---- geometry ------------------------------------------------------------

  function tableLeft(): number {
    return Math.floor((W - TABLEAU_W) / 2);
  }

  function colX(col: number): number {
    return tableLeft() + col * (CARD_W + GAP);
  }

  function hudTop(): number {
    return H - hudRows * HUD_ROW;
  }

  function slotPos(loc: Loc): { x: number; y: number } {
    switch (loc.kind) {
      case "stock": return { x: colX(0), y: TOP_Y };
      case "waste": return { x: colX(1), y: TOP_Y };
      case "foundation": return { x: colX(3 + loc.pile), y: TOP_Y };
      case "tableau": return { x: colX(loc.pile), y: TABLEAU_Y };
    }
  }

  function computeLayout(): void {
    const out: Placement[] = [];
    game.stock.forEach((card, index) => {
      out.push({ card, x: colX(0), y: TOP_Y, loc: STOCK, index });
    });
    const visible = game.drawCount === 3 ? 3 : 1;
    game.waste.forEach((card, index) => {
      const k = Math.max(0, index - (game.waste.length - visible));
      out.push({ card, x: colX(1) + k * WASTE_FAN, y: TOP_Y, loc: WASTE, index });
    });
    game.foundations.forEach((pile, f) => {
      pile.forEach((card, index) => {
        out.push({ card, x: colX(3 + f), y: TOP_Y, loc: { kind: "foundation", pile: f }, index });
      });
    });
    const avail = hudTop() - 4 - TABLEAU_Y - CARD_H;
    game.tableau.forEach((column, col) => {
      const down = column.filter((c) => !c.faceUp).length;
      const up = column.length - down;
      let fanUp = FAN_UP_MAX;
      const needed = down * FAN_DOWN + Math.max(0, up - 1) * fanUp;
      if (needed > avail && up > 1) {
        fanUp = clamp(Math.floor((avail - down * FAN_DOWN) / (up - 1)), FAN_UP_MIN, FAN_UP_MAX);
      }
      let y = TABLEAU_Y;
      column.forEach((card, index) => {
        out.push({ card, x: colX(col), y, loc: { kind: "tableau", pile: col }, index });
        y += card.faceUp ? fanUp : FAN_DOWN;
      });
    });
    placements = out;
    placementById.clear();
    for (const p of out) placementById.set(p.card.id, p);
  }

  function pileRect(loc: Loc): { x: number; y: number; w: number; h: number } {
    const pos = slotPos(loc);
    let bottom = pos.y + CARD_H;
    if (loc.kind === "tableau") {
      for (const p of placements) {
        if (sameLoc(p.loc, loc)) bottom = Math.max(bottom, p.y + CARD_H);
      }
    }
    return { x: pos.x, y: pos.y, w: CARD_W, h: bottom - pos.y };
  }

  // ---- views and tweens ------------------------------------------------------

  function viewOf(card: Card): View {
    let v = views[card.id];
    if (!v) {
      const pos = slotPos(STOCK);
      v = { x: pos.x, y: pos.y, rot: 0, faceUp: card.faceUp };
      views[card.id] = v;
    }
    return v;
  }

  function tweenOf(id: number): Tween | undefined {
    return tweens.find((t) => t.id === id);
  }

  function startTween(card: Card, x1: number, y1: number, opts: { delay?: number; dur?: number; onStart?: () => void; onDone?: () => void } = {}): void {
    const v = viewOf(card);
    tweens = tweens.filter((t) => t.id !== card.id);
    if (reduceMotion()) {
      v.x = x1;
      v.y = y1;
      opts.onStart?.();
      opts.onDone?.();
      return;
    }
    const dist = Math.hypot(x1 - v.x, y1 - v.y);
    const dur = opts.dur ?? clamp(140 + dist * 0.9, 140, 380);
    tweens.push({
      id: card.id, x0: v.x, y0: v.y, x1, y1,
      t0: performance.now() + (opts.delay ?? 0), dur, z: zCounter++, started: false,
      onStart: opts.onStart, onDone: opts.onDone,
    });
    requestFrame();
  }

  function startFlip(card: Card, to: boolean, delay = 0): void {
    const v = viewOf(card);
    flips = flips.filter((f) => f.id !== card.id);
    if (v.faceUp === to) return;
    if (reduceMotion()) {
      v.faceUp = to;
      return;
    }
    flips.push({ id: card.id, t0: performance.now() + delay, dur: 220, to, swapped: false });
    requestFrame();
  }

  /** Spring every card toward its layout spot. Cards already heading there
   *  are left alone; the dragged run is skipped. */
  function sync(opts: { stagger?: (p: Placement) => number; animate?: boolean } = {}): void {
    computeLayout();
    const animate = opts.animate ?? true;
    for (const p of placements) {
      if (press?.dragging && press.run.includes(p.card)) continue;
      const v = viewOf(p.card);
      const active = tweenOf(p.card.id);
      if (active && active.x1 === p.x && active.y1 === p.y) continue;
      if (v.x === p.x && v.y === p.y && !active) continue;
      if (!animate) {
        tweens = tweens.filter((t) => t.id !== p.card.id);
        v.x = p.x;
        v.y = p.y;
        v.rot = 0;
        continue;
      }
      startTween(p.card, p.x, p.y, { delay: opts.stagger?.(p) ?? 0 });
    }
    // Flip anything whose side disagrees with the model.
    for (const p of placements) {
      const v = viewOf(p.card);
      if (v.faceUp !== p.card.faceUp && !flips.some((f) => f.id === p.card.id)) {
        startFlip(p.card, p.card.faceUp, p.loc.kind === "tableau" && p.card.faceUp ? 120 : 0);
      }
    }
    hover = null;
    syncControls();
    requestFrame();
  }

  // ---- sizing ------------------------------------------------------------------

  function resize(): void {
    const rect = stage.getBoundingClientRect();
    const availW = Math.max(1, Math.floor(rect.width));
    const availH = Math.max(1, Math.floor(rect.height));
    if (availW === lastAvailW && availH === lastAvailH) return;
    lastAvailW = availW;
    lastAvailH = availH;
    let ds = Math.floor(Math.min(availW / MIN_W, availH / MIN_H));
    if (ds >= 2) ds = Math.min(ds, 6);
    else ds = clamp(Math.min(availW / MIN_W, availH / MIN_H), 0.75, 1.999);
    W = Math.max(MIN_W, Math.floor(availW / ds));
    H = Math.max(MIN_H, Math.floor(availH / ds));
    // Two HUD rows when the controls and readouts cannot share one.
    const controlsW = 4 * 3 + (textWidth("NEW") + 6) + (textWidth("UNDO") + 6) + (textWidth("HINT") + 6)
      + (textWidth("DRAW 3") + 6) + 15;
    const readoutsW = 2 * 3 + chipWidth("9999") + chipWidth("99:99") + chipWidth("999");
    hudRows = controlsW + readoutsW + 8 > W ? 2 : 1;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * ds * dpr);
    canvas.height = Math.round(H * ds * dpr);
    canvas.style.width = `${W * ds}px`;
    canvas.style.height = `${H * ds}px`;
    hi.imageSmoothingEnabled = false;
    lo.width = W;
    lo.height = H;
    loCtx.imageSmoothingEnabled = false;
    felt = renderFelt(W, H);
    trails = null;
    if (!won) {
      sync({ animate: false });
      dealing = false;
    } else {
      // The trails cannot survive a resize; drop straight to the banner.
      bouncers = [];
      cascadeQueue = [];
      banner = true;
    }
    requestFrame();
  }

  // ---- game actions --------------------------------------------------------------

  function announce(text: string): void {
    if (live) live.textContent = text;
  }

  function elapsed(): number {
    if (won) return frozenElapsed;
    if (!startedAt) return 0;
    return performance.now() - startedAt;
  }

  function touch(): void {
    if (!startedAt) startedAt = performance.now();
  }

  function clearHint(): void {
    hint = null;
  }

  function newGame(): void {
    window.clearTimeout(autoTimer);
    autoRunning = false;
    won = false;
    banner = false;
    bouncers = [];
    cascadeQueue = [];
    cascadeStarted = false;
    trails = null;
    particles = [];
    popups = [];
    tweens = [];
    flips = [];
    press = null;
    hover = null;
    dropTarget = null;
    clearHint();
    hintCursor = 0;
    startedAt = 0;
    frozenElapsed = 0;
    scoreShown = 0;
    game = new Klondike(drawMode);
    // Every card starts on the stock, face down, and the tableau deals out
    // row by row from there.
    const stock = slotPos(STOCK);
    for (const card of game.cards()) {
      const v = viewOf(card);
      v.x = stock.x;
      v.y = stock.y;
      v.rot = 0;
      v.faceUp = false;
    }
    const order = new Map<number, number>();
    let n = 0;
    for (let row = 0; row < 7; row++) {
      for (let col = row; col < 7; col++) order.set(game.tableau[col][row].id, n++);
    }
    dealing = true;
    computeLayout();
    const dealStep = reduceMotion() ? 0 : 28;
    for (const p of placements) {
      if (p.loc.kind !== "tableau") continue;
      const k = order.get(p.card.id) ?? 0;
      startTween(p.card, p.x, p.y, {
        delay: k * dealStep,
        dur: 260,
        onStart: () => sfx.play("deal", k),
        onDone: () => {
          if (p.card.faceUp) startFlip(p.card, true);
          if (k === n - 1) {
            dealing = false;
            requestFrame();
          }
        },
      });
    }
    if (reduceMotion()) dealing = false;
    sfx.play("shuffle");
    announce(`New game dealt, draw ${drawMode}.`);
    syncControls();
    requestFrame();
  }

  function confirmNewGame(): void {
    const inProgress = game.moves > 0 && !won;
    if (!inProgress || !window.uiDialog) {
      newGame();
      return;
    }
    void window.uiDialog({
      icon: "question",
      title: "Start a new game?",
      body: "The current deal will be lost.",
      buttons: [
        { id: "cancel", label: "Keep playing" },
        { id: "new", label: "New game", primary: true },
      ],
    }).then((r) => {
      if (r === "new") newGame();
    });
  }

  function foundationEffects(card: Card, to: Loc): void {
    const pos = slotPos(to);
    const count = game.foundations[to.pile].length;
    sfx.play("foundation", Math.max(0, count - 1));
    burst(pos.x + CARD_W / 2, pos.y + CARD_H / 2, card.suit, 14);
    popups.push({ text: "+10", x: pos.x + CARD_W / 2, y: pos.y + 14, t0: performance.now(), color: PAL.gold });
    requestFrame();
  }

  function burst(x: number, y: number, suit: Suit, n: number): void {
    if (reduceMotion()) return;
    const color = suit < 2 ? PAL.red : PAL.blackLite;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 90;
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: 0, max: 450 + Math.random() * 350,
        color: Math.random() < 0.5 ? PAL.gold : (Math.random() < 0.5 ? color : PAL.white),
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }

  function applyMove(from: Loc, index: number, to: Loc, source: "drag" | "click" | "auto"): boolean {
    const card = game.pile(from)[index];
    const record = game.move(from, index, to);
    if (!record) return false;
    touch();
    clearHint();
    const landed = (): void => {
      if (to.kind === "foundation") foundationEffects(card, to);
      else sfx.play("place");
      if (game.won() && !won) startWin();
    };
    sync();
    const lead = tweenOf(card.id);
    if (lead) lead.onDone = landed;
    else landed();
    if (record.flipped) {
      const src = game.pile(from);
      const exposed = placementById.get(src[src.length - 1].id);
      if (exposed) popups.push({ text: "+5", x: exposed.x + CARD_W / 2, y: exposed.y + 14, t0: performance.now() + 150, color: PAL.white });
    }
    if (record.score !== 0) bumpScore();
    if (source !== "auto") announce(`${cardName(card)} to ${describeLoc(to)}.`);
    syncControls();
    return true;
  }

  function describeLoc(loc: Loc): string {
    switch (loc.kind) {
      case "foundation": return "its foundation";
      case "tableau": return `column ${loc.pile + 1}`;
      case "waste": return "the waste";
      case "stock": return "the stock";
    }
  }

  function bumpScore(): void {
    scoreShake = reduceMotion() ? 0 : 1;
    requestFrame();
  }

  function draw(): void {
    if (autoRunning || won) return;
    const wasteBefore = game.waste.length;
    const record = game.draw();
    if (!record) {
      sfx.play("invalid");
      return;
    }
    touch();
    clearHint();
    if (record.type === "draw") {
      sfx.play("draw");
      sync();
      announce(`Drew ${game.waste.slice(wasteBefore).map(cardName).join(", ")}.`);
    } else {
      sfx.play("shuffle");
      sync({ stagger: (p) => (p.loc.kind === "stock" ? (record.count - 1 - p.index) * 12 : 0) });
      announce("Waste returned to the stock.");
    }
  }

  function undo(): void {
    if (autoRunning || won) return;
    const record = game.undo();
    if (!record) {
      sfx.play("invalid");
      return;
    }
    clearHint();
    sfx.play("undo");
    sync();
    bumpScore();
    announce("Undid the last move.");
  }

  function showHint(): void {
    if (autoRunning || won) return;
    const hints = game.hints();
    if (hints.length === 0) {
      hint = null;
      sfx.play("invalid");
      announce("No moves left. Try a new game.");
      return;
    }
    hint = hints[hintCursor % hints.length];
    hintCursor++;
    hintT0 = performance.now();
    sfx.play("hint");
    if (hint.type === "draw") announce("Hint: draw from the stock.");
    else announce(`Hint: ${cardName(game.pile(hint.from)[hint.index])} to ${describeLoc(hint.to)}.`);
    requestFrame();
  }

  function autoComplete(): void {
    if (autoRunning || won || !game.autoCompleteAvailable()) return;
    autoRunning = true;
    clearHint();
    announce("Finishing the game.");
    const step = (): void => {
      const record = game.autoStep();
      if (!record) {
        autoRunning = false;
        syncControls();
        return;
      }
      const card = game.pile(record.to)[game.pile(record.to).length - 1];
      sync();
      const t = tweenOf(card.id);
      const landed = (): void => {
        foundationEffects(card, record.to);
        if (game.won() && !won) startWin();
      };
      if (t) t.onDone = landed;
      else landed();
      bumpScore();
      autoTimer = window.setTimeout(step, reduceMotion() ? 0 : 110);
    };
    step();
  }

  function toggleDrawMode(): void {
    drawMode = drawMode === 1 ? 3 : 1;
    game.drawCount = drawMode;
    sfx.play("button");
    sync();
    announce(`Draw ${drawMode}.`);
  }

  function toggleSound(): void {
    sfx.setMuted(!sfx.muted);
    if (!sfx.muted) sfx.play("button");
    announce(sfx.muted ? "Sound off." : "Sound on.");
    syncControls();
    requestFrame();
  }

  function smartMove(p: Placement): void {
    const to = game.autoTarget(p.loc, p.index);
    if (!to) {
      sfx.play("invalid");
      wobble(p);
      return;
    }
    applyMove(p.loc, p.index, to, "click");
  }

  /** A quick shake for a card that has nowhere to go. */
  function wobble(p: Placement): void {
    if (reduceMotion()) return;
    const run = game.runAt(p.loc, p.index) ?? [p.card];
    const t0 = performance.now();
    for (const card of run) {
      const v = viewOf(card);
      const target = placementById.get(card.id);
      if (!target) continue;
      tweens = tweens.filter((t) => t.id !== card.id);
      tweens.push({
        id: card.id, x0: v.x, y0: v.y, x1: target.x, y1: target.y,
        t0, dur: 260, z: zCounter++, started: false,
      });
    }
    wobbleUntil = t0 + 260;
    wobbleIds = new Set(run.map((c) => c.id));
    requestFrame();
  }
  let wobbleUntil = 0;
  let wobbleIds = new Set<number>();

  // ---- win ----------------------------------------------------------------------

  function startWin(): void {
    won = true;
    frozenElapsed = elapsed();
    window.clearTimeout(autoTimer);
    autoRunning = false;
    clearHint();
    sfx.play("win");
    announce(`You won in ${formatTime(frozenElapsed)} with ${game.moves} moves and ${game.score} points. Press N for a new game.`);
    winT0 = performance.now();
    if (reduceMotion()) {
      banner = true;
    } else {
      // Kings first, cycling across the four foundations.
      cascadeQueue = [];
      for (let i = 12; i >= 0; i--) {
        for (let f = 0; f < 4; f++) {
          const card = game.foundations[f][i];
          if (card) cascadeQueue.push(card);
        }
      }
      cascadeNext = winT0 + 700;
    }
    syncControls();
    requestFrame();
  }

  /** Debug rigs behind `?rig=`: "auto" lays every card face up on the
   *  tableau, one suit per column, so the AUTO button appears at once;
   *  "won" fills the foundations and starts the win. Both skip playing
   *  the 52 cards it otherwise takes to reach the endgame. */
  function applyRig(kind: "auto" | "won"): void {
    const all = game.cards();
    game.stock = [];
    game.waste = [];
    game.foundations = [[], [], [], []];
    game.tableau = [[], [], [], [], [], [], []];
    game.history = [];
    for (const card of all) {
      card.faceUp = true;
      viewOf(card).faceUp = true;
      if (kind === "won") game.foundations[card.suit].push(card);
      else game.tableau[card.suit].push(card);
    }
    for (const f of game.foundations) f.sort((a, b) => a.rank - b.rank);
    for (const t of game.tableau) t.sort((a, b) => b.rank - a.rank);
    tweens = [];
    flips = [];
    dealing = false;
    sync({ animate: false });
    announce(kind === "won" ? "Rigged a won game." : "Rigged a finished tableau.");
    if (kind === "won") startWin();
  }

  function launchBouncer(card: Card): void {
    const v = viewOf(card);
    bouncers.push({
      card, x: v.x, y: v.y,
      vx: (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 100),
      vy: -(20 + Math.random() * 140),
    });
  }

  function snapshotTrails(): void {
    trails = makeCanvas(W, H);
    ctx2d(trails).drawImage(lo, 0, 0);
  }

  function skipCascade(): void {
    bouncers = [];
    cascadeQueue = [];
    banner = true;
    if (cascadeStarted) snapshotTrails();
    requestFrame();
  }

  // ---- HUD ------------------------------------------------------------------------

  function layoutButtons(): void {
    const canUndo = game.history.length > 0 && !autoRunning && !won;
    const auto = game.autoCompleteAvailable() && !autoRunning && !won;
    const specs: Omit<Button, "x" | "y" | "w" | "h">[] = [
      { id: "new", label: "NEW", color: PAL.red, dark: PAL.redDark, enabled: true },
      { id: "undo", label: "UNDO", color: PAL.blue, dark: PAL.blueDark, enabled: canUndo },
    ];
    // Once the game can finish itself a hint is moot, so AUTO takes HINT's
    // slot and the row keeps its width.
    if (auto) specs.push({ id: "auto", label: "AUTO", color: PAL.green, dark: PAL.greenDark, enabled: true, pulse: true });
    else specs.push({ id: "hint", label: "HINT", color: PAL.amber, dark: PAL.amberDark, enabled: !autoRunning && !won });
    specs.push({ id: "draw", label: `DRAW ${drawMode}`, color: PAL.slateLight, dark: PAL.slate, enabled: !autoRunning && !won });
    specs.push({ id: "sound", icon: sfx.muted ? "soundOff" : "soundOn", color: PAL.slateLight, dark: PAL.slate, enabled: true });
    const y = hudTop() + 3;
    let x = 4;
    buttons = specs.map((s) => {
      const w = s.label ? textWidth(s.label) + 6 : ICONS[s.icon!][0].length + 6;
      const b: Button = { ...s, x, y, w, h: 13 };
      x += w + 3;
      return b;
    });
  }

  function drawButton(b: Button, now: number): void {
    const hovered = hoverButton === b.id && b.enabled;
    const pressed = pressedButton === b.id;
    let dy = 0;
    if (pressed) dy = 2;
    else if (hovered) dy = -1;
    if (b.pulse && !reduceMotion()) dy += Math.round(Math.sin(now / 160) * 1);
    const color = b.enabled ? b.color : PAL.grey;
    const dark = b.enabled ? b.dark : PAL.greyDark;
    pxRoundRect(loCtx, b.x, b.y + 2, b.w, b.h, 2, PAL.ink);
    if (!pressed) pxRoundRect(loCtx, b.x, b.y + 1, b.w, b.h, 2, dark);
    pxRoundRect(loCtx, b.x, b.y + dy, b.w, b.h, 2, color);
    if (hovered && !pressed) {
      loCtx.fillStyle = "rgba(255,255,255,0.18)";
      loCtx.fillRect(b.x + 2, b.y + dy + 1, b.w - 4, 1);
    }
    const fg = b.enabled ? PAL.white : "#B9C0C2";
    if (b.label) {
      drawText(loCtx, b.label, b.x + 3, b.y + dy + 3, fg, PAL.ink);
    } else if (b.icon) {
      drawIcon(loCtx, b.icon, b.x + 3, b.y + dy + 3, fg, PAL.ink);
    }
  }

  function chipWidth(text: string): number {
    return 7 + 3 + textWidth(text) + 6;
  }

  function drawChip(x: number, y: number, icon: string, text: string, color: string): void {
    const w = chipWidth(text);
    pxRoundRect(loCtx, x, y + 1, w, 13, 2, PAL.ink);
    pxRoundRect(loCtx, x, y, w, 13, 2, PAL.slate);
    drawIcon(loCtx, icon, x + 3, y + 3, "#C7D0D3");
    drawText(loCtx, text, x + 13, y + 3, color, PAL.ink);
  }

  function drawHud(now: number): void {
    const top = hudTop();
    loCtx.fillStyle = "rgba(0,0,0,0.22)";
    loCtx.fillRect(0, top, W, hudRows * HUD_ROW);
    loCtx.fillStyle = "rgba(0,0,0,0.35)";
    loCtx.fillRect(0, top, W, 1);
    for (const b of buttons) drawButton(b, now);

    // Readouts, right-aligned; on the second row when the HUD wraps.
    const y = (hudRows === 2 ? top + HUD_ROW : top) + 3;
    const score = Math.round(scoreShown);
    const chips: [string, string, string][] = [
      ["star", String(score), PAL.gold],
      ["clock", formatTime(elapsed()), PAL.white],
      ["cards", String(game.moves), PAL.white],
    ];
    let x = W - 4;
    for (let i = chips.length - 1; i >= 0; i--) {
      const [icon, text, color] = chips[i];
      x -= chipWidth(text);
      let shake = 0;
      if (i === 0 && scoreShake > 0.02) shake = Math.round(Math.sin(now / 18) * scoreShake * 2);
      drawChip(x, y + shake, icon, text, color);
      x -= 3;
    }
  }

  function buttonAt(lx: number, ly: number): Button | null {
    for (const b of buttons) {
      if (lx >= b.x && lx < b.x + b.w && ly >= b.y - 1 && ly < b.y + b.h + 2) return b;
    }
    return null;
  }

  function runButton(id: string): void {
    switch (id) {
      case "new": confirmNewGame(); break;
      case "undo": undo(); break;
      case "hint": showHint(); break;
      case "auto": autoComplete(); break;
      case "draw": toggleDrawMode(); break;
      case "sound": toggleSound(); break;
    }
  }

  /** Mirror enabled state onto the screen-reader toolbar. */
  function syncControls(): void {
    layoutButtons();
    root.querySelectorAll<HTMLButtonElement>("[data-sol-action]").forEach((el) => {
      const id = el.dataset.solAction ?? "";
      const b = buttons.find((x) => x.id === id);
      if (id === "auto") {
        el.hidden = !b;
        return;
      }
      if (id === "draw-stock") {
        el.disabled = won || autoRunning;
        return;
      }
      if (b) el.disabled = !b.enabled;
      if (id === "draw") el.textContent = `Draw ${drawMode === 1 ? "one" : "three"} (switch)`;
      if (id === "sound") el.setAttribute("aria-pressed", String(!sfx.muted));
    });
  }

  // ---- drawing ----------------------------------------------------------------

  function drawCardSprite(card: Card, faceUp: boolean, x: number, y: number, rot: number, sx: number, shadow: number): void {
    const sprite = faceUp ? cardFace(card.suit, card.rank) : cardBack();
    if (shadow > 0) {
      const tint = `rgba(0,0,0,${shadow > 1 ? 0.4 : 0.28})`;
      const sdx = shadow > 1 ? 3 : 1;
      const sdy = shadow > 1 ? 4 : 1;
      if (rot === 0 && sx === 1) {
        pxRoundRect(loCtx, Math.round(x) + sdx, Math.round(y) + sdy, CARD_W, CARD_H, 2, tint);
      } else {
        loCtx.save();
        loCtx.translate(Math.round(x + CARD_W / 2) + sdx, Math.round(y + CARD_H / 2) + sdy);
        loCtx.rotate(rot);
        loCtx.scale(sx, 1);
        pxRoundRect(loCtx, -Math.floor(CARD_W / 2), -Math.floor(CARD_H / 2), CARD_W, CARD_H, 2, tint);
        loCtx.restore();
      }
    }
    if (rot === 0 && sx === 1) {
      loCtx.drawImage(sprite, Math.round(x), Math.round(y));
      return;
    }
    loCtx.save();
    loCtx.translate(Math.round(x + CARD_W / 2), Math.round(y + CARD_H / 2));
    loCtx.rotate(rot);
    loCtx.scale(Math.max(0.02, sx), 1);
    loCtx.drawImage(sprite, -Math.floor(CARD_W / 2), -Math.floor(CARD_H / 2));
    loCtx.restore();
  }

  function flipScale(id: number, now: number): { sx: number; faceUp: boolean | null } {
    const f = flips.find((x) => x.id === id);
    if (!f || now < f.t0) return { sx: 1, faceUp: null };
    const t = clamp((now - f.t0) / f.dur, 0, 1);
    const v = views[id];
    if (t >= 0.5 && !f.swapped) {
      f.swapped = true;
      v.faceUp = f.to;
      if (now - lastFlipSound > 45) {
        lastFlipSound = now;
        sfx.play("flip");
      }
    }
    return { sx: Math.abs(Math.cos(t * Math.PI)), faceUp: v.faceUp };
  }

  function drawSlots(): void {
    const stock = slotPos(STOCK);
    loCtx.drawImage(slotSprite("stock"), stock.x, stock.y);
    const waste = slotPos(WASTE);
    loCtx.drawImage(slotSprite("tableau"), waste.x, waste.y);
    for (let f = 0; f < 4; f++) {
      const p = slotPos({ kind: "foundation", pile: f });
      loCtx.drawImage(slotSprite("foundation", f as Suit), p.x, p.y);
    }
    for (let c = 0; c < 7; c++) {
      const p = slotPos({ kind: "tableau", pile: c });
      loCtx.drawImage(slotSprite("tableau"), p.x, p.y);
    }
  }

  function drawHighlight(x: number, y: number, w: number, h: number, color: string): void {
    pxRoundOutline(loCtx, x - 1, y - 1, w + 2, h + 2, 2, color);
    pxRoundOutline(loCtx, x - 2, y - 2, w + 4, h + 4, 3, color);
  }

  function drawHints(now: number): void {
    if (!hint) return;
    const phase = reduceMotion() ? 1 : (Math.sin((now - hintT0) / 140) + 1) / 2;
    const color = phase > 0.5 ? PAL.gold : PAL.amber;
    if (hint.type === "draw") {
      const s = slotPos(STOCK);
      drawHighlight(s.x, s.y, CARD_W, CARD_H, color);
      return;
    }
    const run = game.runAt(hint.from, hint.index);
    const lead = placementById.get(game.pile(hint.from)[hint.index]?.id ?? -1);
    if (run && lead) {
      const last = placementById.get(run[run.length - 1].id) ?? lead;
      drawHighlight(lead.x, lead.y, CARD_W, last.y + CARD_H - lead.y, color);
    }
    const target = pileRect(hint.to);
    drawHighlight(target.x, target.y, target.w, target.h, PAL.green);
  }

  function drawParticles(dt: number): void {
    const next: Particle[] = [];
    for (const p of particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.vy += 260 * (dt / 1000);
      p.x += p.vx * (dt / 1000);
      p.y += p.vy * (dt / 1000);
      const frac = p.life / p.max;
      // Dither the fade instead of blending, so sparks stay crisp.
      if (frac > 0.6 && Math.floor(p.life / 40) % 2 === 0) { next.push(p); continue; }
      loCtx.fillStyle = p.color;
      loCtx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      next.push(p);
    }
    particles = next;
  }

  function drawPopups(now: number): void {
    const next: Popup[] = [];
    for (const p of popups) {
      const t = (now - p.t0) / 800;
      if (t >= 1) continue;
      if (t > 0.7 && Math.floor(now / 50) % 2 === 0) { next.push(p); continue; }
      const w = textWidth(p.text);
      drawText(loCtx, p.text, Math.round(p.x - w / 2), Math.round(p.y - easeOutCubic(t) * 14), p.color, PAL.ink);
      next.push(p);
    }
    popups = next;
  }

  /** Pixel-doubled text, each letter bobbing on its own phase. */
  function drawBigText(text: string, cx: number, y: number, color: string, shadow: string, now: number, jiggle: boolean): void {
    loCtx.save();
    loCtx.scale(2, 2);
    let x = Math.round(cx / 2 - textWidth(text) / 2);
    const yy = Math.round(y / 2);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const dy = jiggle ? Math.round(Math.sin(now / 130 + i * 0.7) * 1.5) : 0;
      drawText(loCtx, ch, x, yy + dy, color, shadow);
      x += textWidth(ch) + 1;
    }
    loCtx.restore();
  }

  function drawBanner(now: number): void {
    const lines = [
      `SCORE ${game.score}`,
      `TIME ${formatTime(frozenElapsed)}`,
      `MOVES ${game.moves}`,
    ];
    const pw = 132;
    const ph = 92;
    const px = Math.round(W / 2 - pw / 2);
    const py = Math.round(Math.max(TOP_Y, hudTop() / 2 - ph / 2));
    pxRoundRect(loCtx, px + 1, py + 3, pw, ph, 3, PAL.ink);
    pxRoundRect(loCtx, px, py, pw, ph, 3, PAL.gold);
    pxRoundRect(loCtx, px + 2, py + 2, pw - 4, ph - 4, 2, PAL.slate);
    drawBigText("YOU WIN!", W / 2, py + 12, PAL.gold, PAL.ink, now, !reduceMotion());
    let ly = py + 36;
    for (const line of lines) {
      drawText(loCtx, line, Math.round(W / 2 - textWidth(line) / 2), ly, PAL.white, PAL.ink);
      ly += 11;
    }
    const label = "NEW GAME";
    const bw = textWidth(label) + 10;
    const bx = Math.round(W / 2 - bw / 2);
    const by = py + ph - 20;
    const pressed = pressedButton === "banner";
    pxRoundRect(loCtx, bx, by + 2, bw, 13, 2, PAL.ink);
    if (!pressed) pxRoundRect(loCtx, bx, by + 1, bw, 13, 2, PAL.redDark);
    pxRoundRect(loCtx, bx, by + (pressed ? 2 : hoverButton === "banner" ? -1 : 0), bw, 13, 2, PAL.red);
    drawText(loCtx, label, bx + 5, by + 3 + (pressed ? 2 : hoverButton === "banner" ? -1 : 0), PAL.white, PAL.ink);
    bannerButton = { x: bx, y: by, w: bw, h: 13 };
  }
  let bannerButton: { x: number; y: number; w: number; h: number } | null = null;

  function render(now: number): void {
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;

    // Advance tweens.
    const finished: Tween[] = [];
    for (const t of tweens) {
      if (now < t.t0) continue;
      if (!t.started) {
        t.started = true;
        t.onStart?.();
      }
      const v = views[t.id];
      const p = clamp((now - t.t0) / t.dur, 0, 1);
      const wob = wobbleIds.has(t.id) && now < wobbleUntil;
      const e = wob ? 1 : easeOutBack(p);
      v.x = t.x0 + (t.x1 - t.x0) * e + (wob ? Math.round(Math.sin((now - t.t0) / 22) * 3 * (1 - p)) : 0);
      v.y = t.y0 + (t.y1 - t.y0) * e;
      if (p >= 1) {
        v.x = t.x1;
        v.y = t.y1;
        finished.push(t);
      }
    }
    if (finished.length) {
      tweens = tweens.filter((t) => !finished.includes(t));
      for (const t of finished) t.onDone?.();
    }
    for (const f of flips) {
      if (now >= f.t0 + f.dur) views[f.id].faceUp = f.to;
    }
    flips = flips.filter((f) => now < f.t0 + f.dur);
    if (scoreShake > 0) scoreShake = Math.max(0, scoreShake - dt / 260);
    const scoreGap = game.score - scoreShown;
    scoreShown = Math.abs(scoreGap) < 0.5 ? game.score : scoreShown + scoreGap * Math.min(1, dt / 90);

    // Drag tilt eases back toward level.
    if (press?.dragging) {
      dragVel *= 0.8;
      for (const card of press.run) {
        const v = viewOf(card);
        v.rot += (clamp(dragVel * 0.012, -0.22, 0.22) - v.rot) * 0.25;
      }
    }

    if (won) {
      if (!banner) {
        renderCascade(now, dt);
        hi.drawImage(lo, 0, 0, canvas.width, canvas.height);
        requestFrame();
        return;
      }
      if (trails) {
        loCtx.drawImage(trails, 0, 0);
      } else {
        loCtx.drawImage(felt, 0, 0);
        drawSlots();
        for (const p of placements) {
          const v = viewOf(p.card);
          drawCardSprite(p.card, v.faceUp, v.x, v.y, 0, 1, 1);
        }
      }
      drawParticles(dt);
      drawBanner(now);
      hi.drawImage(lo, 0, 0, canvas.width, canvas.height);
      if (!reduceMotion() || particles.length) requestFrame();
      return;
    }

    loCtx.drawImage(felt, 0, 0);
    drawSlots();
    {
      // Static cards in layout order, skipping anything in flight or held.
      const flying = new Set(tweens.filter((t) => t.started).map((t) => t.id));
      const held = new Set(press?.dragging ? press.run.map((c) => c.id) : []);
      const hovered = new Set<number>();
      if (hover && !press && !autoRunning) {
        const run = game.runAt(hover.loc, hover.index);
        if (run) for (const c of run) hovered.add(c.id);
      }
      const tilt = hovered.size && !reduceMotion() ? Math.sin(now / 170) * 0.035 : 0;
      for (const p of placements) {
        if (flying.has(p.card.id) || held.has(p.card.id)) continue;
        const v = viewOf(p.card);
        const f = flipScale(p.card.id, now);
        const lift = hovered.has(p.card.id) ? 2 : 0;
        drawCardSprite(p.card, f.faceUp ?? v.faceUp, v.x, v.y - lift, hovered.has(p.card.id) ? tilt : 0, f.sx, 1);
      }
      drawHints(now);
      if (dropTarget) {
        const r = pileRect(dropTarget);
        drawHighlight(r.x, r.y, r.w, r.h, PAL.green);
      }
      const inFlight = tweens.filter((t) => t.started).sort((a, b) => a.z - b.z);
      for (const t of inFlight) {
        const p = placementById.get(t.id);
        if (!p || held.has(t.id)) continue;
        const v = views[t.id];
        const f = flipScale(t.id, now);
        drawCardSprite(p.card, f.faceUp ?? v.faceUp, v.x, v.y, 0, f.sx, 1);
      }
      if (press?.dragging) {
        for (const card of press.run) {
          const v = viewOf(card);
          drawCardSprite(card, v.faceUp, v.x, v.y, v.rot, 1, 2);
        }
      }
      drawParticles(dt);
      drawPopups(now);
      drawHud(now);
    }

    hi.drawImage(lo, 0, 0, canvas.width, canvas.height);

    const animating = tweens.length > 0 || flips.length > 0 || particles.length > 0 || popups.length > 0
      || press?.dragging || hover !== null || hint !== null || scoreShake > 0 || Math.abs(scoreGap) >= 0.5
      || buttons.some((b) => b.pulse);
    if (animating) requestFrame();
  }

  let cascadeStarted = false;

  function renderCascade(now: number, dt: number): void {
    // No clear: the bouncing cards paint over the last frame, the classic
    // trail. The first cascade frame starts from the finished table.
    if (!cascadeStarted) {
      loCtx.drawImage(felt, 0, 0);
      drawSlots();
      for (const p of placements) {
        const v = viewOf(p.card);
        drawCardSprite(p.card, v.faceUp, v.x, v.y, 0, 1, 1);
      }
      cascadeStarted = true;
    }
    if (now >= cascadeNext && cascadeQueue.length) {
      launchBouncer(cascadeQueue.shift()!);
      cascadeNext = now + 120;
    }
    const s = dt / 1000;
    const floor = H;
    const next: Bouncer[] = [];
    for (const b of bouncers) {
      b.vy += 900 * s;
      b.x += b.vx * s;
      b.y += b.vy * s;
      if (b.y + CARD_H > floor) {
        b.y = floor - CARD_H;
        b.vy = -Math.abs(b.vy) * 0.78;
        sfx.play("bounce");
      }
      drawCardSprite(b.card, true, b.x, b.y, 0, 1, 0);
      if (b.x > -CARD_W && b.x < W) next.push(b);
    }
    bouncers = next;
    if (!bouncers.length && !cascadeQueue.length) {
      banner = true;
      snapshotTrails();
    }
  }

  function requestFrame(): void {
    if (frameQueued) return;
    frameQueued = true;
    window.requestAnimationFrame((now) => {
      frameQueued = false;
      render(now);
    });
  }

  // ---- input --------------------------------------------------------------------

  function toLogical(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  function placementAt(lx: number, ly: number): Placement | null {
    for (let i = placements.length - 1; i >= 0; i--) {
      const p = placements[i];
      if (lx >= p.x && lx < p.x + CARD_W && ly >= p.y && ly < p.y + CARD_H) return p;
    }
    return null;
  }

  function inRect(lx: number, ly: number, r: { x: number; y: number; w: number; h: number }): boolean {
    return lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h;
  }

  function updateCursor(): void {
    let cursor = "default";
    if (press?.dragging) cursor = "grabbing";
    else if (hoverButton) cursor = "pointer";
    else if (hover) cursor = hover.loc.kind === "stock" ? "pointer" : "grab";
    canvas.style.cursor = cursor;
  }

  function findDropTarget(p: Press): Loc | null {
    const lead = viewOf(p.run[0]);
    const leadRect = { x: lead.x, y: lead.y, w: CARD_W, h: CARD_H };
    let best: Loc | null = null;
    let bestArea = 0;
    const candidates: Loc[] = [];
    for (let c = 0; c < 7; c++) candidates.push({ kind: "tableau", pile: c });
    for (let f = 0; f < 4; f++) candidates.push({ kind: "foundation", pile: f });
    for (const loc of candidates) {
      if (sameLoc(loc, p.placement.loc)) continue;
      const r = pileRect(loc);
      const ox = Math.min(leadRect.x + leadRect.w, r.x + r.w) - Math.max(leadRect.x, r.x);
      const oy = Math.min(leadRect.y + leadRect.h, r.y + r.h) - Math.max(leadRect.y, r.y);
      if (ox <= 0 || oy <= 0) continue;
      const area = ox * oy;
      if (area > bestArea && game.canDrop(p.run, loc)) {
        bestArea = area;
        best = loc;
      }
    }
    return best;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    sfx.unlock();
    canvas.focus({ preventScroll: true });
    const { x, y } = toLogical(e);
    pointerX = x;

    if (won) {
      if (!banner) {
        skipCascade();
        return;
      }
      if (bannerButton && inRect(x, y, bannerButton)) {
        pressedButton = "banner";
        requestFrame();
      }
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const b = buttonAt(x, y);
    if (b) {
      if (!b.enabled) {
        sfx.play("invalid");
        return;
      }
      pressedButton = b.id;
      canvas.setPointerCapture(e.pointerId);
      requestFrame();
      return;
    }
    if (dealing || autoRunning) return;

    const p = placementAt(x, y);
    if (p) {
      if (p.loc.kind === "stock") {
        draw();
        return;
      }
      const run = game.runAt(p.loc, p.index);
      if (!run) {
        sfx.play("invalid");
        wobble(p);
        return;
      }
      const offsets = run.map((card) => {
        const pl = placementById.get(card.id)!;
        return { dx: pl.x - x, dy: pl.y - y };
      });
      press = { placement: p, run, offsets, startX: x, startY: y, dragging: false };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const stock = slotPos(STOCK);
    if (inRect(x, y, { x: stock.x, y: stock.y, w: CARD_W, h: CARD_H })) draw();
  }

  function onPointerMove(e: PointerEvent): void {
    const { x, y } = toLogical(e);
    const dx = x - pointerX;
    pointerX = x;

    if (press) {
      if (!press.dragging && Math.hypot(x - press.startX, y - press.startY) > DRAG_THRESHOLD) {
        press.dragging = true;
        clearHint();
        sfx.play("pickup");
        for (const card of press.run) tweens = tweens.filter((t) => t.id !== card.id);
        zCounter++;
      }
      if (press.dragging) {
        dragVel = dragVel * 0.5 + dx * 0.5;
        press.run.forEach((card, i) => {
          const v = viewOf(card);
          v.x = x + press!.offsets[i].dx;
          v.y = y + press!.offsets[i].dy;
        });
        dropTarget = findDropTarget(press);
        updateCursor();
        requestFrame();
      }
      return;
    }

    if (won) {
      const over = banner && bannerButton && inRect(x, y, bannerButton) ? "banner" : null;
      if (over !== hoverButton) {
        hoverButton = over;
        canvas.style.cursor = over ? "pointer" : "default";
        requestFrame();
      }
      return;
    }

    const b = buttonAt(x, y);
    const nextButton = b && b.enabled ? b.id : null;
    let nextHover: Placement | null = null;
    if (!nextButton && !dealing && !autoRunning) {
      const p = placementAt(x, y);
      if (p && (p.loc.kind === "stock" || game.runAt(p.loc, p.index))) nextHover = p;
    }
    if (nextButton !== hoverButton || nextHover !== hover) {
      hoverButton = nextButton;
      hover = nextHover;
      updateCursor();
      requestFrame();
    }
  }

  function onPointerUp(e: PointerEvent): void {
    const { x, y } = toLogical(e);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);

    if (pressedButton) {
      const id = pressedButton;
      pressedButton = null;
      if (id === "banner") {
        if (bannerButton && inRect(x, y, bannerButton)) {
          sfx.play("button");
          newGame();
        }
      } else {
        const b = buttonAt(x, y);
        if (b && b.id === id && b.enabled) {
          if (id !== "sound") sfx.play("button");
          runButton(id);
        }
      }
      requestFrame();
      return;
    }

    if (!press) return;
    const p = press;
    press = null;
    dropTarget = null;
    if (!p.dragging) {
      smartMove(p.placement);
      updateCursor();
      return;
    }
    dragVel = 0;
    for (const card of p.run) viewOf(card).rot = 0;
    const target = findDropTarget(p);
    if (target && applyMove(p.placement.loc, p.placement.index, target, "drag")) {
      updateCursor();
      return;
    }
    // No home: spring back.
    sfx.play(target ? "invalid" : "place");
    sync();
    updateCursor();
  }

  function onPointerCancel(): void {
    pressedButton = null;
    if (press) {
      press = null;
      dropTarget = null;
      sync();
    }
    updateCursor();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.altKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target && target !== canvas && target.tagName === "BUTTON") return;
    const key = e.key.toLowerCase();
    if (e.ctrlKey) {
      if (key === "z") {
        e.preventDefault();
        undo();
      }
      return;
    }
    switch (key) {
      case "n": confirmNewGame(); break;
      case "z": case "u": undo(); break;
      case "h": showHint(); break;
      case "a": autoComplete(); break;
      case "m": toggleSound(); break;
      case "d": toggleDrawMode(); break;
      case " ": case "enter":
        if (won) {
          if (banner) newGame();
          else skipCascade();
        } else {
          draw();
        }
        break;
      case "escape":
        if (press) {
          onPointerCancel();
        } else if (hint) {
          clearHint();
          requestFrame();
        } else {
          return;
        }
        break;
      default:
        return;
    }
    e.preventDefault();
    sfx.unlock();
  }

  // ---- wiring -------------------------------------------------------------------

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", () => {
    if (press) return;
    if (hover || hoverButton) {
      hover = null;
      hoverButton = null;
      updateCursor();
      requestFrame();
    }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  root.addEventListener("keydown", onKeyDown);
  root.querySelectorAll<HTMLButtonElement>("[data-sol-action]").forEach((el) => {
    el.addEventListener("click", () => {
      sfx.unlock();
      const id = el.dataset.solAction ?? "";
      if (id === "draw-stock") draw();
      else runButton(id);
    });
  });

  const observer = new ResizeObserver(() => resize());
  observer.observe(stage);
  window.setInterval(() => {
    if (startedAt && !won && document.visibilityState === "visible") requestFrame();
  }, 1000);

  resize();
  newGame();
  const rig = new URLSearchParams(window.location.search).get("rig");
  if (rig === "auto" || rig === "won") applyRig(rig);
  root.dataset.solReady = "";
})();
