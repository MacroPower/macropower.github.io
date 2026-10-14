// ANSI escape helpers and the One Dark palette that readline, the banner,
// and the commands share. The --up-aod-* custom properties in main.css
// repeat some of the palette's hex values, so change both together.

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

/** The OSC 0 sequence that sets the terminal window's title, which
 *  Ubuntu's default .bashrc writes before each prompt. A control
 *  character in `title`, such as a BEL in a directory name, ends the
 *  sequence early, so windowTitle() drops each one. */
export function windowTitle(title: string): string {
  return `\x1b]0;${title.replace(/[\x00-\x1f\x7f-\x9f]/g, "")}\x07`;
}

// Strip CSI escape sequences, such as SGR colors, and OSC sequences. The
// commands that read a pipe, such as grep and wc, then match and count
// captured output as plain text. An OSC sequence ends at BEL or at ESC \.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
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

// Maps neofetch color-mask letters (assets/unity/home/colors.txt) to palette hex values.
export const MASK_COLORS: Readonly<Record<string, string>> = {
  O: PALETTE.orange,
  Y: PALETTE.yellow,
  G: PALETTE.green,
  B: PALETTE.blue,
  P: PALETTE.purple,
  C: PALETTE.cyan,
  R: PALETTE.red,
  M: PALETTE.muted,
};
