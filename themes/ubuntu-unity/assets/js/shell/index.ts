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

  // Swap the disposed terminal for the reconnect overlay (.up-shell-reconnect
  // styles live in main.scss): the closed-connection text `exit` printed plus
  // a "[ Reconnect ]" line. Click or Enter/Space rebuilds the shell fresh.
  const showReconnect = (): void => {
    const overlay = document.createElement("div");
    overlay.className = "up-shell-reconnect";
    overlay.tabIndex = 0;
    overlay.setAttribute("role", "button");

    const logout = document.createElement("div");
    logout.textContent = "logout";
    const closed = document.createElement("div");
    closed.textContent = `Connection to ${data.host} closed.`;
    const btn = document.createElement("div");
    btn.className = "up-shell-reconnect-btn";
    btn.textContent = "[ Reconnect ]";
    overlay.append(logout, closed, btn);

    const reconnect = (): void => {
      overlay.remove();
      // Release the height frozen at exit; the fresh boot re-derives the
      // window's natural size from xterm's rendered rows, like first load.
      mount.style.minHeight = "";
      boot().focus();
    };
    overlay.addEventListener("click", reconnect);
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        reconnect();
      }
    });

    mount.appendChild(overlay);
    overlay.focus();
  };

  // Build the terminal + shell pair. Runs once at startup and again after
  // each reconnect; `exit` tears the pair down via the shell's onExit hook.
  const boot = (): XtermTerminal => {
    const term = new XtermTerminal(mount);
    const shell = new Shell(term, data, {
      history: loadHistory(),
      persist: saveHistory,
      onExit: () => {
        // The window's height is content-driven by xterm's rendered rows.
        // Freeze it before the teardown so swapping in the three-line
        // reconnect overlay (height:100%) keeps the window at its size
        // instead of shrink-wrapping it to a small box mid-desktop.
        mount.style.minHeight = `${mount.offsetHeight}px`;
        term.dispose();
        // dispose() removes xterm's element; replaceChildren is the backstop
        // that guarantees an empty mount for the overlay (and the next boot).
        mount.replaceChildren();
        root.removeAttribute("data-shell-ready");
        showReconnect();
      },
    });
    registerAll(shell);

    writeBanner(term, data);
    term.writeln("");
    term.writeln(color(PALETTE.muted, "Type 'help' for a list of commands."));
    term.writeln("");
    shell.start();
    root.setAttribute("data-shell-ready", "");
    return term;
  };

  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    boot();
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
