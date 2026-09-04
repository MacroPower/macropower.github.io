// Pixel art for the solitaire table: a 5x7 bitmap font, suit pips, the
// face-card busts, the aubergine card back, and the empty-slot outlines. All
// of it is authored as strings of '#'/'.' (or a per-sprite legend) and
// rasterized with 1px fillRects at the table's logical resolution; index.ts
// upscales the whole frame with nearest-neighbor sampling, which is what
// gives the game its chunky Balatro look. Card faces and backs are drawn
// once into offscreen canvases and cached, so a frame is only drawImage
// calls.

import { isRed, RANK_LABELS, type Suit } from "./klondike";

export const CARD_W = 31;
export const CARD_H = 43;

export const PAL = {
  outline: "#2A2426",
  paper: "#F4EFE2",
  paperShade: "#D9D2C0",
  paperHi: "#FFFFFF",
  parchment: "#EFE4C8",
  red: "#E84A4A",
  redDark: "#B22C2C",
  black: "#262A33",
  blackLite: "#4A5060",
  aubergine: "#5E2750",
  aubergineLight: "#77216F",
  orange: "#DD4814",
  gold: "#F2C14E",
  goldDark: "#B07D1F",
  ruby: "#E84A4A",
  sapphire: "#3B8BEB",
  skin: "#F1C27D",
  hair: "#5B3A1E",
  white: "#FFFFFF",
  felt: "#1F5A46",
  feltLight: "#276A52",
  feltDark: "#184A3A",
  feltLine: "#3F8C70",
  ink: "#141214",
  slate: "#2F3A3E",
  slateLight: "#465559",
  blue: "#3B8BEB",
  blueDark: "#2762AB",
  green: "#4BC292",
  greenDark: "#2F8A66",
  amber: "#F2A33A",
  amberDark: "#B8741E",
  grey: "#6E7A7E",
  greyDark: "#4B5457",
};

export function suitColor(suit: Suit): string {
  return isRed(suit) ? PAL.red : PAL.black;
}

type Rows = string[];

interface BlitOpts {
  rot180?: boolean;
  flipV?: boolean;
}

/** Paint a string sprite. Characters map to colors via `colors`; '.' and
 *  ' ' are transparent, and any unmapped character falls back to '#'. */
export function blit(
  ctx: CanvasRenderingContext2D, rows: Rows, x: number, y: number,
  colors: Record<string, string>, opts: BlitOpts = {},
): void {
  const h = rows.length;
  const w = rows[0].length;
  for (let j = 0; j < h; j++) {
    const row = rows[j];
    for (let i = 0; i < w; i++) {
      const ch = row[i];
      if (ch === "." || ch === " ") continue;
      const color = colors[ch] ?? colors["#"];
      if (!color) continue;
      let px = i;
      let py = j;
      if (opts.rot180) { px = w - 1 - i; py = h - 1 - j; }
      else if (opts.flipV) { py = h - 1 - j; }
      ctx.fillStyle = color;
      ctx.fillRect(x + px, y + py, 1, 1);
    }
  }
}

/** Fill a rectangle with pixel-rounded corners (r in 0..3). */
export function pxRoundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string,
): void {
  const insets = r <= 0 ? [] : r === 1 ? [1] : r === 2 ? [2, 1] : [3, 2, 1, 1];
  ctx.fillStyle = color;
  for (let j = 0; j < h; j++) {
    const edge = Math.min(j, h - 1 - j);
    const inset = edge < insets.length ? insets[edge] : 0;
    ctx.fillRect(x + inset, y + j, w - inset * 2, 1);
  }
}

/** A 1px pixel-rounded outline (the fill minus its inner fill). */
export function pxRoundOutline(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string,
): void {
  pxRoundRect(ctx, x, y, w, h, r, color);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  pxRoundRect(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, r - 1), "#000");
  ctx.restore();
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

// ---- font ----------------------------------------------------------------

const FONT: Record<string, Rows> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": [".#.", "##.", ".#.", ".#.", ".#.", ".#.", "###"],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  ":": [".", "#", ".", ".", ".", "#", "."],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  ",": [".", ".", ".", ".", ".", "#", "#"],
  "!": ["#", "#", "#", "#", "#", ".", "#"],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  "+": ["...", "...", ".#.", "###", ".#.", "...", "..."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "'": ["#", "#", ".", ".", ".", ".", "."],
  "(": [".#", "#.", "#.", "#.", "#.", "#.", ".#"],
  ")": ["#.", ".#", ".#", ".#", ".#", ".#", "#."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
};

export const FONT_H = 7;
const LETTER_GAP = 1;

function glyph(ch: string): Rows {
  return FONT[ch.toUpperCase()] ?? FONT["?"];
}

export function textWidth(text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += glyph(text[i])[0].length;
    if (i < text.length - 1) w += LETTER_GAP;
  }
  return w;
}

const glyphCache = new Map<string, HTMLCanvasElement>();

function glyphSprite(ch: string, color: string): HTMLCanvasElement {
  const key = `${ch.toUpperCase()}|${color}`;
  let sprite = glyphCache.get(key);
  if (!sprite) {
    const rows = glyph(ch);
    sprite = makeCanvas(rows[0].length, rows.length);
    blit(ctx2d(sprite), rows, 0, 0, { "#": color });
    glyphCache.set(key, sprite);
  }
  return sprite;
}

/** Draw a line of the bitmap font. Returns the width painted. `shadow`
 *  adds a 1px offset drop shadow underneath. */
export function drawText(
  ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, shadow?: string,
): number {
  let cx = x;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (shadow) ctx.drawImage(glyphSprite(ch, shadow), cx + 1, y + 1);
    ctx.drawImage(glyphSprite(ch, color), cx, y);
    cx += glyph(ch)[0].length + LETTER_GAP;
  }
  return cx - x - LETTER_GAP;
}

// ---- pips ----------------------------------------------------------------

const PIP_SMALL: Rows[] = [
  // hearts
  [".#.#.", "#####", "#####", ".###.", "..#.."],
  // diamonds
  ["..#..", ".###.", "#####", ".###.", "..#.."],
  // clubs
  ["..#..", ".###.", "##.##", "#####", "..#.."],
  // spades
  ["..#..", ".###.", "#####", "#####", "..#.."],
];

const PIP_BIG: Rows[] = [
  [
    ".###...###.",
    "#####.#####",
    "###########",
    "###########",
    "###########",
    ".#########.",
    "..#######..",
    "...#####...",
    "....###....",
    ".....#.....",
    "...........",
  ],
  [
    ".....#.....",
    "....###....",
    "...#####...",
    "..#######..",
    ".#########.",
    "###########",
    ".#########.",
    "..#######..",
    "...#####...",
    "....###....",
    ".....#.....",
  ],
  [
    "....###....",
    "...#####...",
    "...#####...",
    ".##.###.##.",
    "###########",
    "###########",
    "###########",
    ".###.#.###.",
    ".....#.....",
    "....###....",
    "...#####...",
  ],
  [
    ".....#.....",
    "....###....",
    "...#####...",
    "..#######..",
    ".#########.",
    "###########",
    "###########",
    "###########",
    ".###.#.###.",
    ".....#.....",
    "...#####...",
  ],
];

export function drawPipSmall(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, color: string, flipV = false): void {
  blit(ctx, PIP_SMALL[suit], x, y, { "#": color }, { flipV });
}

export function drawPipBig(ctx: CanvasRenderingContext2D, suit: Suit, x: number, y: number, color: string): void {
  blit(ctx, PIP_BIG[suit], x, y, { "#": color });
}

// Pip positions per rank on a number card: column (left/center/right) and
// the row's top y. Pips in the lower half hang upside down like real cards.
type Col = "L" | "C" | "R";
const PIP_X: Record<Col, number> = { L: 6, C: 13, R: 20 };
const PIP_LAYOUT: Record<number, [Col, number][]> = {
  2: [["C", 11], ["C", 27]],
  3: [["C", 11], ["C", 19], ["C", 27]],
  4: [["L", 11], ["R", 11], ["L", 27], ["R", 27]],
  5: [["L", 11], ["R", 11], ["C", 19], ["L", 27], ["R", 27]],
  6: [["L", 11], ["R", 11], ["L", 19], ["R", 19], ["L", 27], ["R", 27]],
  7: [["L", 11], ["R", 11], ["C", 15], ["L", 19], ["R", 19], ["L", 27], ["R", 27]],
  8: [["L", 11], ["R", 11], ["C", 15], ["L", 19], ["R", 19], ["C", 23], ["L", 27], ["R", 27]],
  9: [["L", 11], ["R", 11], ["L", 16], ["R", 16], ["C", 19], ["L", 22], ["R", 22], ["L", 27], ["R", 27]],
  10: [["L", 11], ["R", 11], ["C", 14], ["L", 16], ["R", 16], ["L", 22], ["R", 22], ["C", 24], ["L", 27], ["R", 27]],
};

// ---- face cards ------------------------------------------------------------
// 17x17 busts. Legend: g gold, d dark gold, r ruby, b sapphire, h hair,
// s skin, e eye, c cloak, C cloak trim, w white.

const KING: Rows = [
  "....g...g...g....",
  "....g.g.g.g.g....",
  "....ggggggggg....",
  "....grgbgrgbg....",
  "....ggggggggg....",
  "....hhhhhhhhh....",
  "...hsssssssssh...",
  "...hssesssessh...",
  "...hsssssssssh...",
  "....sssssssss....",
  "....shhhhhhhs....",
  ".....hhhhhhh.....",
  "......hhhhh......",
  "....CCCCCCCCC....",
  "..CCCcccccccCCC..",
  ".CCCCcccccccCCCC.",
  ".CCCCcccccccCCCC.",
];

const QUEEN: Rows = [
  "........g........",
  ".......gbg.......",
  "....g..ggg..g....",
  "....ggggggggg....",
  "...hhhhhhhhhhh...",
  "...hhssssssshh...",
  "...hhsesssesshh..",
  "...hhssssssshh...",
  "...hhssssssshh...",
  "...hh.sssss.hh...",
  "...hh..sss..hh...",
  "...hh.......hh...",
  "..CCCCwgwgwgCCCC.",
  ".CCCCCcccccCCCCC.",
  ".CCCCCcccccCCCCC.",
  ".CCCCCcccccCCCCC.",
  ".CCCCCcccccCCCCC.",
];

const JACK: Rows = [
  "............w....",
  "...........ww....",
  "....ccccccccw....",
  "...cccccccccc....",
  "...cccccccccc....",
  "..CCCCCCCCCCCC...",
  "....hhhhhhhhh....",
  "...hsssssssssh...",
  "...hssesssessh...",
  "...hsssssssssh...",
  "....sssssssss....",
  ".....sssssss.....",
  "......sssss......",
  "....CCCCCCCCC....",
  "..CCCcccccccCCC..",
  ".CCCCcccccccCCCC.",
  ".CCCCcccccccCCCC.",
];

const BUSTS: Record<number, Rows> = { 11: JACK, 12: QUEEN, 13: KING };

function bustColors(suit: Suit): Record<string, string> {
  const red = isRed(suit);
  return {
    g: PAL.gold, d: PAL.goldDark, r: PAL.ruby, b: PAL.sapphire,
    h: PAL.hair, s: PAL.skin, e: PAL.ink, w: PAL.white,
    c: red ? PAL.red : PAL.blackLite,
    C: red ? PAL.redDark : PAL.black,
  };
}

// ---- cards ----------------------------------------------------------------

/** The paper card body: outline, fill, and a one-pixel bevel. */
function drawCardBase(ctx: CanvasRenderingContext2D): void {
  pxRoundRect(ctx, 0, 0, CARD_W, CARD_H, 2, PAL.outline);
  pxRoundRect(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 1, PAL.paper);
  ctx.fillStyle = PAL.paperShade;
  ctx.fillRect(2, CARD_H - 2, CARD_W - 4, 1);
  ctx.fillRect(CARD_W - 2, 2, 1, CARD_H - 4);
  ctx.fillStyle = PAL.paperHi;
  ctx.fillRect(2, 1, CARD_W - 4, 1);
  ctx.fillRect(1, 2, 1, CARD_H - 4);
}

function drawIndex(ctx: CanvasRenderingContext2D, rank: number, suit: Suit, color: string): void {
  const label = RANK_LABELS[rank];
  const rw = textWidth(label);
  // Top-left index, then the same index rotated into the bottom-right
  // corner so a card reads either way up.
  drawText(ctx, label, 3, 3, color);
  drawPipSmall(ctx, suit, 3 + rw + 2, 4, color);
  const ix = CARD_W - 3;
  const iy = CARD_H - 3;
  for (let i = 0; i < label.length; i++) {
    // drawText has no rotation, so mirror glyph by glyph.
    const rows = glyph(label[i]);
    let offset = 0;
    for (let k = 0; k < i; k++) offset += glyph(label[k])[0].length + LETTER_GAP;
    blit(ctx, rows, ix - offset - rows[0].length, iy - FONT_H, { "#": color }, { rot180: true });
  }
  blit(ctx, PIP_SMALL[suit], ix - rw - 2 - 5, iy - 1 - 5, { "#": color }, { rot180: true });
}

const faceCache = new Map<number, HTMLCanvasElement>();
let backCache: HTMLCanvasElement | null = null;

export function cardFace(suit: Suit, rank: number): HTMLCanvasElement {
  const key = suit * 13 + rank;
  let sprite = faceCache.get(key);
  if (sprite) return sprite;
  sprite = makeCanvas(CARD_W, CARD_H);
  const ctx = ctx2d(sprite);
  const color = suitColor(suit);
  drawCardBase(ctx);
  drawIndex(ctx, rank, suit, color);
  if (rank === 1) {
    drawPipBig(ctx, suit, 10, 16, color);
  } else if (rank <= 10) {
    for (const [col, y] of PIP_LAYOUT[rank]) {
      drawPipSmall(ctx, suit, PIP_X[col], y, color, y >= 22);
    }
  } else {
    // Framed portrait panel.
    pxRoundRect(ctx, 5, 11, 21, 21, 1, color);
    pxRoundRect(ctx, 6, 12, 19, 19, 1, PAL.parchment);
    blit(ctx, BUSTS[rank], 7, 13, bustColors(suit));
  }
  faceCache.set(key, sprite);
  return sprite;
}

/** The Ubuntu circle of friends at 13x13: a ring broken by three beads
 *  ('o') at the right, lower left, and upper left. */
const CIRCLE_OF_FRIENDS: Rows = [
  ".....###.....",
  "...o#...##...",
  ".....#....#..",
  ".#.........#.",
  ".#.........#.",
  "#...........#",
  "#...........o",
  "#...........#",
  ".#.........#.",
  ".#.........#.",
  ".....#....#..",
  "...o#...##...",
  ".....###.....",
];

export function cardBack(): HTMLCanvasElement {
  if (backCache) return backCache;
  const sprite = makeCanvas(CARD_W, CARD_H);
  const ctx = ctx2d(sprite);
  // Every layer is opaque: the stock draws two dozen backs on one spot,
  // so any transparent pixel would stack their shadows into black.
  pxRoundRect(ctx, 0, 0, CARD_W, CARD_H, 2, PAL.outline);
  pxRoundRect(ctx, 1, 1, CARD_W - 2, CARD_H - 2, 1, PAL.paper);
  pxRoundRect(ctx, 2, 2, CARD_W - 4, CARD_H - 4, 1, PAL.aubergine);
  pxRoundRect(ctx, 3, 3, CARD_W - 6, CARD_H - 6, 1, PAL.orange);
  pxRoundRect(ctx, 4, 4, CARD_W - 8, CARD_H - 8, 1, PAL.aubergine);
  // Diamond lattice.
  ctx.fillStyle = PAL.aubergineLight;
  for (let y = 5; y < CARD_H - 5; y++) {
    for (let x = 5; x < CARD_W - 5; x++) {
      if ((x + y) % 4 === 0 || (x - y + 64) % 4 === 0) ctx.fillRect(x, y, 1, 1);
    }
  }
  // Central medallion.
  pxRoundRect(ctx, 7, 13, 17, 17, 2, PAL.orange);
  pxRoundRect(ctx, 8, 14, 15, 15, 1, PAL.aubergine);
  blit(ctx, CIRCLE_OF_FRIENDS, 9, 15, { "#": PAL.orange, o: PAL.white });
  backCache = sprite;
  return sprite;
}

// ---- slots ------------------------------------------------------------------

const RECYCLE: Rows = [
  "...........",
  "....###....",
  "...#...#...",
  "..#.....#..",
  ".#.......#.",
  "###......#.",
  ".#.......#.",
  ".........#.",
  "........#..",
  "......##...",
  "...........",
];

const slotCache = new Map<string, HTMLCanvasElement>();

export type SlotKind = "tableau" | "stock" | "foundation";

export function slotSprite(kind: SlotKind, suit: Suit = 0): HTMLCanvasElement {
  const key = `${kind}:${suit}`;
  let sprite = slotCache.get(key);
  if (sprite) return sprite;
  sprite = makeCanvas(CARD_W, CARD_H);
  const ctx = ctx2d(sprite);
  pxRoundOutline(ctx, 0, 0, CARD_W, CARD_H, 2, PAL.feltLine);
  if (kind === "foundation") drawPipBig(ctx, suit, 10, 16, PAL.feltLine);
  if (kind === "stock") blit(ctx, RECYCLE, 10, 16, { "#": PAL.feltLine });
  slotCache.set(key, sprite);
  return sprite;
}

// ---- HUD icons ---------------------------------------------------------------

export const ICONS: Record<string, Rows> = {
  star: ["...#...", "...#...", "#######", ".#####.", "..###..", ".##.##.", "#.....#"],
  clock: [".#####.", "#..#..#", "#..#..#", "#..##.#", "#.....#", "#.....#", ".#####."],
  cards: ["..#####", "..#...#", "#####.#", "#...#.#", "#...###", "#...#..", "#####.."],
  soundOn: ["...#.....", "..##..#..", "####...#.", "####.#.#.", "####...#.", "..##..#..", "...#....."],
  soundOff: ["...#.....", "..##.#.#.", "####..#..", "####..#..", "####.#.#.", "..##.....", "...#....."],
};

export function drawIcon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, color: string, shadow?: string): number {
  const rows = ICONS[name];
  if (shadow) blit(ctx, rows, x + 1, y + 1, { "#": shadow });
  blit(ctx, rows, x, y, { "#": color });
  return rows[0].length;
}

/** Felt with an ordered-dither vignette, rendered once per resize. */
export function renderFelt(w: number, h: number): HTMLCanvasElement {
  const felt = makeCanvas(w, h);
  const ctx = ctx2d(felt);
  const img = ctx.createImageData(w, h);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const shades = [PAL.feltLight, PAL.felt, PAL.feltDark].map(hexToRgb);
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 0 at the center, 1 at the corners, biased so the lighter pool sits
      // under the tableau rather than a pinpoint.
      const d = Math.hypot(x - cx, y - cy) / maxD;
      const level = Math.min(2, Math.max(0, d * 2.6 - 0.5));
      const threshold = bayer[(y & 3) * 4 + (x & 3)] / 16;
      const idx = Math.min(2, Math.floor(level + threshold));
      const rgb = shades[idx];
      const o = (y * w + x) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return felt;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
