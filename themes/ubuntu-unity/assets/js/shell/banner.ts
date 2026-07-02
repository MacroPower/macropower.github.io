import type { ShellData } from "./shell";
import type { TerminalIO } from "./terminal";
import {
  bg,
  bold,
  boldColor,
  color,
  fg,
  FG_DEFAULT,
  MASK_COLORS,
  PALETTE,
  PALETTE_BRIGHT,
  RESET,
} from "./ansi";

const GAP = 3; // columns between the ASCII art and the info block

// Applies the color-mask (assets/home/colors.txt) over a single ASCII art line,
// grouping same-colored runs into truecolor SGR sequences. Colored runs reset
// only the foreground (FG_DEFAULT), never the full attributes, so a line-level
// BOLD wrapper survives across every run -- the whole art renders semi-bold.
function colorizeLine(line: string, mask: string): string {
  let out = "";
  let runHex = "";
  let runText = "";
  const flush = (): void => {
    if (!runText) return;
    out += runHex ? `${fg(runHex)}${runText}${FG_DEFAULT}` : runText;
    runText = "";
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    const hex = MASK_COLORS[mask[i] ?? " "] ?? "";
    if (hex === runHex) {
      runText += ch;
    } else {
      flush();
      runHex = hex;
      runText = ch;
    }
  }
  flush();
  return out;
}

function truncate(s: string, max: number): string {
  if (max <= 0) return "";
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

function paletteRow(hexes: string[]): string {
  return hexes.map((h) => `${bg(h)}   ${RESET}`).join("");
}

// A social row's rendered (post-truncation) display text mapped to its full
// URL, so the renderer can linkify the bare-domain display the web-links addon
// would otherwise ignore (it only matches full http(s) URLs).
export interface BannerLink {
  text: string;
  url: string;
}

// Builds the info block: header, rule, Name/Title/Uptime rows, social links
// (trimmed display form), and the two color-swatch rows. `valueWidth` caps the
// value column so no line exceeds the terminal width and wraps -- a wrap would
// shove rows out of alignment. Returns the rendered social display strings as
// link annotations so the renderer can make them clickable.
function infoLines(
  data: ShellData,
  labelWidth: number,
  valueWidth: number,
): { lines: string[]; links: BannerLink[] } {
  const header = `${boldColor(PALETTE.red, data.handle)}@${boldColor(PALETTE.blue, data.host)}`;
  const headerPlain = `${data.handle}@${data.host}`;
  const rule = color(PALETTE.muted, "-".repeat(headerPlain.length));

  const row = (label: string, value: string, valueHex: string): string =>
    `${boldColor(PALETTE.red, label.padEnd(labelWidth))}  ${color(valueHex, truncate(value, valueWidth))}`;

  const lines: string[] = [header, rule];
  const links: BannerLink[] = [];
  lines.push(row("name", data.name, PALETTE.fg));
  lines.push(row("title", data.title, PALETTE.fg));
  lines.push(row("focus", data.focus, PALETTE.fg));
  lines.push(row("uptime", data.uptime, PALETTE.fg));
  lines.push("");
  for (const s of data.socials) {
    const shown = truncate(s.display, valueWidth);
    lines.push(`${boldColor(PALETTE.red, s.label.padEnd(labelWidth))}  ${color(PALETTE.blue, shown)}`);
    links.push({ text: shown, url: s.url });
  }
  lines.push("");
  lines.push(paletteRow([
    PALETTE.bg, PALETTE.red, PALETTE.green, PALETTE.yellow,
    PALETTE.blue, PALETTE.purple, PALETTE.cyan, PALETTE.fg,
  ]));
  lines.push(paletteRow([
    PALETTE_BRIGHT.black, PALETTE_BRIGHT.red, PALETTE_BRIGHT.green, PALETTE_BRIGHT.yellow,
    PALETTE_BRIGHT.blue, PALETTE_BRIGHT.purple, PALETTE_BRIGHT.cyan, PALETTE_BRIGHT.white,
  ]));
  return { lines, links };
}

const MIN_VALUE = 12; // value column narrower than this -> drop the art

/**
 * Renders the neofetch banner as an array of ANSI lines sized to `cols`.
 * Side-by-side (art left, info right) when wide enough; otherwise the art is
 * skipped entirely -- clipping it to `cols` would slice glyphs mid-character
 * (the old SSR design likewise hid the art under 560px) -- and the info block
 * renders alone at full width. Either way the info value column is truncated
 * so no line wraps, which would break alignment.
 */
export function renderBanner(data: ShellData, cols: number): { lines: string[]; links: BannerLink[] } {
  const artLines = data.ascii.replace(/\n+$/, "").split("\n");
  const maskLines = data.colors.replace(/\n+$/, "").split("\n");
  const artWidth = artLines.reduce((m, l) => Math.max(m, l.length), 0);
  const labelWidth = Math.max("uptime".length, ...data.socials.map((s) => s.label.length));

  const sideRoom = cols - artWidth - GAP - labelWidth - 2;
  if (sideRoom < MIN_VALUE) {
    // Too narrow for the art: info block only, using the full width.
    const valueWidth = Math.max(MIN_VALUE, cols - labelWidth - 2);
    return infoLines(data, labelWidth, valueWidth);
  }

  const info = infoLines(data, labelWidth, sideRoom);
  const rows = Math.max(artLines.length, info.lines.length);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    const art = artLines[r] ?? "";
    const colored = bold(colorizeLine(art, maskLines[r] ?? ""));
    const pad = " ".repeat(artWidth - art.length + GAP);
    out.push(`${colored}${pad}${info.lines[r] ?? ""}`);
  }
  return { lines: out, links: info.links };
}

export function writeBanner(term: TerminalIO, data: ShellData): void {
  const { lines, links } = renderBanner(data, term.cols());
  for (const line of lines) term.writeln(line);
  term.registerLinks(links);
}
