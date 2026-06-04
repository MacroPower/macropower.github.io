import { Terminal } from "@xterm/xterm";
import type { IDisposable, ILink } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { PALETTE, PALETTE_BRIGHT } from "./ansi";

// Renderer-agnostic terminal surface. The shell core (readline, shell,
// commands) talks only to this interface; XtermTerminal is the sole xterm
// binding, so swapping renderers means writing one new implementation.
export interface TerminalIO {
  write(data: string): void;
  writeln(data: string): void;
  clear(): void;
  focus(): void;
  fit(): void;
  cols(): number;
  /** Make each link's display `text` clickable (opens its `url`) wherever it
   *  appears in the buffer; replaces any previously registered set. */
  registerLinks(links: { text: string; url: string }[]): void;
  onData(cb: (data: string) => void): void;
  dispose(): void;
}

// Cross-bundle contract: page-window.ts dispatches this event name on resize
// (maximize/restore). The shell is a separate IIFE and cannot import the
// symbol, so the literal string is duplicated here. Keep in sync with
// WINDOW_STATE_EVENT in page-window.ts (recorded in the theme CLAUDE.md).
const WINDOW_STATE_EVENT = "up:page-window-state";

const FONT_FAMILY = '"Ubuntu Mono", ui-monospace, Menlo, monospace';
// Font shorthand probes for document.fonts.load()/check(): the faces xterm
// actually renders (regular + ANSI-bold). index.ts gates construction on
// loading these; the constructor backstop checks them.
export const FONT_PROBES = ['16px "Ubuntu Mono"', '700 16px "Ubuntu Mono"'];

export class XtermTerminal implements TerminalIO {
  private readonly term: Terminal;
  private readonly fitAddon: FitAddon;
  private readonly disposables: IDisposable[] = [];
  private resizeObserver?: ResizeObserver;
  private fitRaf = 0;
  private linkDisposable?: IDisposable;

  constructor(mount: HTMLElement) {
    this.term = new Terminal({
      fontFamily: FONT_FAMILY,
      // Matches the .up-neofetch font size in main.scss (12pt); keep in sync.
      fontSize: 16,
      lineHeight: 1.2,
      cursorBlink: true,
      allowTransparency: true,
      convertEol: false,
      // Send Option+key as a Meta escape (ESC-prefixed) so the readline Alt
      // word bindings (Alt-B/F/D) work on macOS, as in a real terminal.
      macOptionIsMeta: true,
      theme: {
        // Transparent background lets the container's .up-neofetch HUD
        // (color-mix + backdrop-filter:blur) show the wallpaper through.
        background: "rgba(0,0,0,0)",
        foreground: PALETTE.fg,
        cursor: PALETTE.fg,
        cursorAccent: PALETTE.bg,
        selectionBackground: "rgba(171,178,191,0.30)",
        black: PALETTE.bg,
        red: PALETTE.red,
        green: PALETTE.green,
        yellow: PALETTE.yellow,
        blue: PALETTE.blue,
        magenta: PALETTE.purple,
        cyan: PALETTE.cyan,
        white: PALETTE.fg,
        brightBlack: PALETTE_BRIGHT.black,
        brightRed: PALETTE_BRIGHT.red,
        brightGreen: PALETTE_BRIGHT.green,
        brightYellow: PALETTE_BRIGHT.yellow,
        brightBlue: PALETTE_BRIGHT.blue,
        brightMagenta: PALETTE_BRIGHT.purple,
        brightCyan: PALETTE_BRIGHT.cyan,
        brightWhite: PALETTE_BRIGHT.white,
      },
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());

    this.term.open(mount);
    this.fit();

    // Re-fit on mount resize (debounced via rAF) and on page-window
    // maximize/restore.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => { this.scheduleFit(); });
      this.resizeObserver.observe(mount);
    }
    this.onWindowState = this.onWindowState.bind(this);
    this.onWindowResize = this.onWindowResize.bind(this);
    window.addEventListener(WINDOW_STATE_EVENT, this.onWindowState);
    window.addEventListener("resize", this.onWindowResize);

    // index.ts builds us only after Ubuntu Mono activates (when FontFaceSet is
    // available — without it, both its gate and this backstop no-op together),
    // so metrics are correct. Its load gate has a timeout fallback though: if
    // the font lands after that, we were measured with the fallback font, and
    // xterm caches cell metrics until a fontFamily/fontSize change (it ignores
    // no-op writes). Re-measure when the font finishes by switching fontFamily
    // to a distinct but visually identical string — this clears the glyph
    // width cache, resets the renderer, and re-measures; then re-fit so the
    // column count matches the corrected cell width. (Already-written output
    // keeps the layout it was written for — see the slow-path note in
    // index.ts.)
    if (document.fonts?.ready && FONT_PROBES.some((p) => !document.fonts.check(p))) {
      void document.fonts.ready.then(() => {
        this.term.options.fontFamily = `${FONT_FAMILY}, monospace`;
        this.fit();
      });
    }
  }

  private onWindowState(): void { this.scheduleFit(); }
  private onWindowResize(): void { this.scheduleFit(); }

  private scheduleFit(): void {
    if (this.fitRaf) return;
    this.fitRaf = requestAnimationFrame(() => {
      this.fitRaf = 0;
      this.fit();
    });
  }

  write(data: string): void { this.term.write(data); }
  writeln(data: string): void { this.term.write(`${data}\r\n`); }
  clear(): void { this.term.clear(); }
  focus(): void { this.term.focus(); }
  cols(): number { return this.term.cols; }

  registerLinks(links: { text: string; url: string }[]): void {
    this.linkDisposable?.dispose();
    const targets = links.filter((l) => l.text);
    if (targets.length === 0) return;
    this.linkDisposable = this.term.registerLinkProvider({
      provideLinks: (y, callback) => {
        const line = this.term.buffer.active.getLine(y - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString(true);
        const found: ILink[] = [];
        for (const { text: t, url } of targets) {
          let from = 0;
          for (;;) {
            const idx = text.indexOf(t, from);
            if (idx === -1) break;
            from = idx + t.length;
            // Only linkify a display string that starts a value (preceded by a
            // space), so the same bare domain inside a full https:// URL (e.g.
            // the `social` command's output) is left to WebLinksAddon.
            if (idx > 0 && text[idx - 1] !== " ") continue;
            found.push({
              range: { start: { x: idx + 1, y }, end: { x: idx + t.length, y } },
              text: t,
              activate: () => { window.open(url, "_blank", "noopener"); },
            });
          }
        }
        callback(found.length ? found : undefined);
      },
    });
  }

  fit(): void {
    try {
      this.fitAddon.fit();
    } catch {
      // FitAddon throws if the mount has no layout yet; ignore and retry on
      // the next resize tick.
    }
  }

  onData(cb: (data: string) => void): void {
    this.disposables.push(this.term.onData(cb));
  }

  dispose(): void {
    if (this.fitRaf) cancelAnimationFrame(this.fitRaf);
    this.linkDisposable?.dispose();
    this.resizeObserver?.disconnect();
    window.removeEventListener(WINDOW_STATE_EVENT, this.onWindowState);
    window.removeEventListener("resize", this.onWindowResize);
    for (const d of this.disposables) d.dispose();
    this.term.dispose();
  }
}
