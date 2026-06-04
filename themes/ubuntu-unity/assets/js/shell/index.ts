import { XtermTerminal, FONT_PROBES } from "./terminal";
import { Shell, type ShellData } from "./shell";
import { writeBanner } from "./banner";
import { color, PALETTE } from "./ansi";
import { registerAll } from "./commands/all";

const HISTORY_KEY = "up:shell-history";

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory(items: readonly string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-500)));
  } catch {
    // localStorage may be unavailable (private mode); history stays in-memory.
  }
}

(function (): void {
  "use strict";

  const root = document.querySelector<HTMLElement>("[data-shell]");
  if (!root) return;

  const dataEl = root.querySelector<HTMLScriptElement>("[data-shell-data]");
  const mount = root.querySelector<HTMLElement>("[data-shell-mount]");
  if (!dataEl || !mount) return;

  let data: ShellData;
  try {
    data = JSON.parse(dataEl.textContent ?? "") as ShellData;
  } catch {
    return;
  }

  // Ubuntu Mono is Google-hosted with display=swap, so on a cold cache it is
  // not yet active when this deferred bundle runs. xterm measures the cell
  // once at open() and only re-measures on a fontFamily/fontSize change, so
  // building the terminal before the font activates bakes in fallback-font
  // metrics and renders garbled until reload. Actively load the faces first
  // (fonts.load() fetches and resolves on activation, unlike fonts.ready,
  // which can resolve before the font is even requested), then build. Race a
  // timeout so a stalled or failed font fetch never blocks the shell; if the
  // font lands after the timeout, terminal.ts re-measures the glyph metrics,
  // though output already written (the banner) keeps the column layout it was
  // sized for — an accepted residual: slow-path only, and cosmetic (wrapped or
  // ragged banner columns, not garbled glyphs).
  const FONT_TIMEOUT_MS = 1500;

  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;

    const term = new XtermTerminal(mount);
    const shell = new Shell(term, data, {
      history: loadHistory(),
      persist: saveHistory,
    });
    registerAll(shell);

    writeBanner(term, data);
    term.writeln("");
    term.writeln(color(PALETTE.muted, "Type 'help' for a list of commands."));
    term.writeln("");
    shell.start();
    root.setAttribute("data-shell-ready", "");
  };

  if (document.fonts?.load) {
    const fonts = Promise.all(FONT_PROBES.map((f) => document.fonts.load(f)));
    const timeout = new Promise<void>((r) => setTimeout(r, FONT_TIMEOUT_MS));
    // load() rejects on fetch failure for a known face; start either way.
    void Promise.race([fonts, timeout]).then(start, start);
  } else {
    start();
  }
})();
