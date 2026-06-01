// ANSI escape helpers and the One Dark palette shared by readline, banner,
// and commands. Hex values mirror the swatches enumerated in layouts/index.html
// and the --aod-* custom properties in main.scss; keep them in sync.

const ESC = "\x1b[";

export const RESET = `${ESC}0m`;
export const BOLD = `${ESC}1m`;
// Reset foreground to default without touching other attributes (e.g. bold).
export const FG_DEFAULT = `${ESC}39m`;

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Truecolor foreground SGR for a `#rrggbb` hex string. */
export function fg(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return `${ESC}38;2;${r};${g};${b}m`;
}

/** Wrap `text` in a truecolor foreground run, resetting afterward. */
export function color(hex: string, text: string): string {
  return `${fg(hex)}${text}${RESET}`;
}

/** Truecolor background SGR for a `#rrggbb` hex string. */
export function bg(hex: string): string {
  const [r, g, b] = parseHex(hex);
  return `${ESC}48;2;${r};${g};${b}m`;
}

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

/** Bold + truecolor foreground run (used for neofetch labels/header). */
export function boldColor(hex: string, text: string): string {
  return `${BOLD}${fg(hex)}${text}${RESET}`;
}

// Cursor / line editing escapes used by readline.
export const cursorLeft = (n = 1): string => (n > 0 ? `${ESC}${n}D` : "");
export const cursorRight = (n = 1): string => (n > 0 ? `${ESC}${n}C` : "");
export const eraseLine = `${ESC}2K`;

// Strip CSI/SGR escape sequences so captured command output can be matched and
// counted as plain text when piped into another command (grep, wc, ...).
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// One Dark palette. The 8 normal + 8 bright slots map to xterm's 16 ANSI
// colors in terminal.ts; the named entries below drive banner/command output.
export const PALETTE = {
  fg: "#ABB2BF",
  bg: "#282C34",
  muted: "#5C6370",
  red: "#E06C75",
  orange: "#D19A66",
  yellow: "#E5C07B",
  green: "#98C379",
  blue: "#61AFEF",
  purple: "#C678DD",
  cyan: "#56B6C2",
  white: "#DCDFE4",
} as const;

// Bright variants for the 16-slot ANSI theme.
export const PALETTE_BRIGHT = {
  black: "#5C6370",
  red: "#BE5046",
  green: "#7A9F60",
  yellow: "#D19A66",
  blue: "#4D89C8",
  purple: "#A557C2",
  cyan: "#4F9DA6",
  white: "#DCDFE4",
} as const;

// Maps neofetch color-mask letters (home-colors.txt) to palette hex values.
export const MASK_COLORS: Record<string, string> = {
  O: PALETTE.orange,
  Y: PALETTE.yellow,
  G: PALETTE.green,
  B: PALETTE.blue,
  P: PALETTE.purple,
  C: PALETTE.cyan,
  R: PALETTE.red,
  M: PALETTE.muted,
};
