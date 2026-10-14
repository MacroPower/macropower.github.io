import { XtermTerminal, fontProbes } from "./terminal";
import { monoFamily } from "../fonts";
import { Shell, type ShellData } from "./shell";
import { parseShellIsland } from "./island";
import { writeBanner } from "./banner";
import { formatUptime } from "./uptime";
import { color, PALETTE } from "./ansi";
import { registerAll } from "./commands/all";
import { t } from "../i18n";

// Keyed by the home page's path, which is the site's root, so two sites
// on one origin (user.github.io/a/ and /b/) keep separate histories.
const HISTORY_KEY = `up:shell-history:${location.pathname}`;

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

((): void => {
  const root = document.querySelector<HTMLElement>("[data-shell]");
  if (!root) return;

  const dataEl = root.querySelector<HTMLScriptElement>("[data-shell-data]");
  const mount = root.querySelector<HTMLElement>("[data-shell-mount]");
  if (!dataEl || !mount) return;

  const island = parseShellIsland(dataEl.textContent ?? "");
  if (!island) {
    console.error("unity: the terminal's data island is not a JSON object");
    return;
  }
  // The island carries the date the uptime counts from. Computing the
  // uptime here keeps it current on a page built days ago.
  const { since, ...rest } = island;
  const data: ShellData = { ...rest, uptime: formatUptime(since, new Date()) };

  // The theme self-hosts Ubuntu Mono, the default --up-font-mono face, with
  // font-display:swap. On a cold cache the face is not yet active when this
  // deferred bundle runs, and a site's own web font in the token behaves the
  // same. xterm measures the cell once at open() and re-measures only on a
  // fontFamily or fontSize change. A terminal built before the font
  // activates keeps fallback-font metrics and renders garbled until reload,
  // so the bundle loads the faces before it builds the terminal.
  // fonts.load() fetches a face and resolves when it activates, but
  // fonts.ready can resolve before anything requests the font. A timeout
  // races the load, so a stalled or failed font fetch never blocks the shell.
  // When the font lands after the timeout, terminal.ts re-measures the glyph
  // metrics. Output written before then, such as the banner, keeps the
  // columns the fallback metrics gave it. That residual happens only on the
  // slow path and only shifts banner columns, because every glyph still
  // renders correctly.
  const FONT_TIMEOUT_MS = 1500;

  // Swap the disposed terminal for the reconnect overlay (.up-shell-reconnect
  // styles live in main.css): the closed-connection text `exit` printed plus
  // a "[ Reconnect ]" line. Click or Enter/Space rebuilds the shell fresh.
  const showReconnect = (): void => {
    const overlay = document.createElement("div");
    overlay.className = "up-shell-reconnect";
    overlay.tabIndex = 0;
    overlay.setAttribute("role", "button");
    // The overlay's text imitates ssh in English, so its accessible name
    // comes from the page's language instead.
    overlay.setAttribute("aria-label", t("js_shell_reconnect"));

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
    const fonts = Promise.all(fontProbes(monoFamily(mount)).map((f) => document.fonts.load(f)));
    const timeout = new Promise<void>((r) => setTimeout(r, FONT_TIMEOUT_MS));
    // load() rejects on fetch failure for a known face; start either way.
    void Promise.race([fonts, timeout]).then(start, start);
  } else {
    start();
  }
})();
