import { subscribe, getTrashFocused } from "./focus";
import { WINDOW_STATE_EVENT } from "./page-window";
import { showPreferences, setReduceMotion } from "./prefs";
import type { UPDialogOptions, UPPageWindowState, UPSite } from "./types";

const LAUNCHER_URLS: Record<string, string> = {
  cv: "/cv/",
  blog: "/posts/",
  projects: "/projects/",
  sponsors: "/sponsors/",
  icons: "/icons/",
};

const EMPTY_SITE: UPSite = { handle: "", github: "", rss: "" };
const getSite = (): UPSite => window.UP_SITE ?? EMPTY_SITE;

function navigate(key: string): void {
  const url = LAUNCHER_URLS[key];
  if (!url) {
    console.warn("ubuntu-unity: no launcher URL for", key);
    return;
  }
  window.location.href = url;
}

function dlg(opts: UPDialogOptions): Promise<string | null> {
  return window.uiDialog?.(opts) ?? Promise.resolve<string | null>(null);
}

const DLG_PRESETS: Record<string, (site: UPSite) => UPDialogOptions> = {
  "dlg:launcher-info": () => ({ icon: "info", title: "Launcher is always shown",
    body: "The launcher is part of the shell." }),
  "dlg:shortcuts": () => ({
    icon: "info", title: "Keyboard shortcuts",
    body: "A few shortcuts work across the desktop:",
    details: "Ctrl+W       close the focused window\nEsc           dismiss menus and dialogs\nDrag titlebar to reposition any window or dialog.",
  }),
  "dlg:github": (site) => ({
    icon: "info", title: "Source",
    body: site.github
      ? "This is a personal site living at " + site.github + "."
      : "This is a personal site.",
    buttons: [{ id: "ok", label: "OK", primary: true }],
  }),
  "dlg:subscribe": (site) => ({
    icon: "success", title: "Subscribed",
    body: site.rss
      ? "Pretend-subscribed to " + site.rss + ". Drop the URL into your reader of choice."
      : "Pretend-subscribed. Drop the feed URL into your reader of choice.",
  }),
  "dlg:wired": () => ({ icon: "warning", title: "No wired connection",
    body: "No ethernet cable detected. Plug one in to use a wired network." }),
  "dlg:hotspot": () => ({
    icon: "question", title: "Enable Wi-Fi hotspot?",
    body: "Other devices will be able to share this connection. Estimated battery cost: significant.",
    buttons: [
      { id: "cancel", label: "Cancel" },
      { id: "on", label: "Enable hotspot", primary: true },
    ],
  }),
  "dlg:cal": () => ({ icon: "info", title: "Calendar",
    body: "No events today. The next thing on the calendar is a haircut next Tuesday." }),
};

function renderCalendar(host: HTMLElement, now: Date): void {
  const y = now.getFullYear();
  const m = now.getMonth();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const today = now.getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= dim; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const headRow = document.createElement("div");
  headRow.className = "up-cal-row up-cal-head";
  for (const d of ["M", "T", "W", "T", "F", "S", "S"]) {
    const c = document.createElement("div");
    c.textContent = d;
    headRow.appendChild(c);
  }

  const grid = document.createElement("div");
  grid.className = "up-cal-row";
  for (const c of cells) {
    const cell = document.createElement("div");
    cell.className = "up-cal-cell";
    if (c == null) {
      cell.classList.add("is-empty");
      cell.textContent = "·";
    } else {
      cell.textContent = String(c);
      if (c === today) cell.classList.add("is-today");
    }
    grid.appendChild(cell);
  }

  host.replaceChildren(headRow, grid);
}

async function dispatchAction(action: string): Promise<void> {
  if (action.startsWith("nav:")) { navigate(action.slice(4)); return; }
  if (action === "reload") { window.location.reload(); return; }
  if (action === "fullscreen") {
    void document.documentElement.requestFullscreen?.().catch(() => {});
    return;
  }
  const site = getSite();
  const preset = DLG_PRESETS[action];
  if (preset) { await dlg(preset(site)); return; }
  if (action === "dlg:prefs") {
    await showPreferences();
    return;
  }
  if (action === "dlg:power-saver") {
    setReduceMotion(true);
    await dlg({
      icon: "success", title: "Power saver enabled",
      body: "Animations reduced to save power. Turn motion back on in Edit → Preferences.",
    });
    return;
  }
  if (action === "dlg:logout") {
    const r = await dlg({
      icon: "question", title: "Log out of " + (site.handle || "user") + "?",
      body: "All unsaved windows will be closed. You can sign back in by reloading the page.",
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "out", label: "Log out", primary: true, danger: true },
      ],
    });
    if (r === "out") window.location.reload();
    return;
  }
  console.warn("ubuntu-unity: unknown action", action);
}

async function netClick(row: HTMLElement): Promise<void> {
  const name = row.dataset.netName ?? "";
  const on = row.hasAttribute("data-net-on");
  if (on) {
    await dlg({ icon: "info", title: "Already connected",
      body: "You're connected to " + name + "." });
    return;
  }
  const r = await dlg({
    icon: "question", title: "Connect to " + name + "?",
    body: "This will disconnect you from café-do-bairro. Continue?",
    buttons: [
      { id: "cancel", label: "Cancel" },
      { id: "connect", label: "Connect", primary: true },
    ],
  });
  if (r === "connect") {
    await dlg({
      icon: "warning", title: "Couldn't connect",
      body: "Authentication failed for " + name + ". Check the password and try again.",
    });
  }
}

export function initTopPanel(): void {
  const panel = document.querySelector<HTMLElement>(".up-top-panel[data-ssr]");
  if (!panel) return;
  const titleSlot = panel.querySelector<HTMLElement>('[data-panel-slot="title"]');
  const clockWide = panel.querySelector<HTMLElement>("[data-clock-wide]");
  const clockNarrow = panel.querySelector<HTMLElement>("[data-clock-narrow]");
  const clockLongDate = panel.querySelector<HTMLElement>("[data-clock-longdate]");
  const calendarHost = panel.querySelector<HTMLElement>("[data-calendar]");

  const pageTitle = (titleSlot?.textContent ?? "").trim();
  let winVisible = window.UP_PAGE_WINDOW_STATE?.visible !== false;
  let lastTitleText = titleSlot?.textContent ?? "";

  const setTitle = (text: string): void => {
    if (text === lastTitleText || !titleSlot) return;
    titleSlot.textContent = text;
    lastTitleText = text;
  };

  const syncTitle = (): void => {
    if (getTrashFocused()) { setTitle("Trash"); return; }
    setTitle(winVisible ? pageTitle : "Ubuntu");
  };

  window.addEventListener(WINDOW_STATE_EVENT, (e) => {
    winVisible = Boolean((e as CustomEvent<UPPageWindowState>).detail.visible);
    syncTitle();
  });
  subscribe(syncTitle);

  const narrowMQ = window.matchMedia("(max-width: 560px)");
  const fmtTime = (d: Date): string =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtShortDate = (d: Date): string =>
    d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const fmtLongDate = (d: Date): string =>
    d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  let lastClockText = "";
  const tickClock = (): void => {
    const now = new Date();
    const text = narrowMQ.matches
      ? fmtTime(now)
      : `${fmtShortDate(now)}  ${fmtTime(now)}`;
    if (text === lastClockText) return;
    lastClockText = text;
    const target = narrowMQ.matches ? clockNarrow : clockWide;
    if (target) target.textContent = text;
  };
  const syncClockMode = (): void => {
    if (clockWide) clockWide.hidden = narrowMQ.matches;
    if (clockNarrow) clockNarrow.hidden = !narrowMQ.matches;
    lastClockText = "";
    tickClock();
  };
  // Inline SVGs ignore the UA `[hidden]` rule (it's HTML-namespaced) and lack a
  // `.hidden` IDL property, so toggle the attribute directly. Within a paired set
  // the glyph carrying `altAttr` shows when `altActive` is true, the other when
  // it's false.
  const toggleGlyphPair = (glyphs: HTMLElement[], altAttr: string, altActive: boolean): void => {
    for (const g of glyphs) {
      const isAlt = g.hasAttribute(altAttr);
      g.toggleAttribute("hidden", isAlt ? !altActive : altActive);
    }
  };

  const batGlyphs = Array.from(panel.querySelectorAll<HTMLElement>("[data-bat-glyph]"));
  const batHeadline = panel.querySelector<HTMLElement>("[data-bat-headline]");
  const batDetail = panel.querySelector<HTMLElement>("[data-bat-detail]");
  const batFill = panel.querySelector<HTMLElement>("[data-bat-fill]");
  const batLevelFills = Array.from(panel.querySelectorAll<SVGRectElement>("[data-bat-level-fill]"));

  // Width (viewBox units) of a full glyph fill bar. It starts at x=2.5 and stops
  // just short of the body's inner wall (~x=17.5), so a full charge reads as full
  // without overrunning the outline.
  const BAT_GLYPH_FILL_MAX = 14;

  const fmtDuration = (mins: number): string => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    const unit = (n: number, u: string): string => `${n} ${u}${n === 1 ? "" : "s"}`;
    const parts: string[] = [];
    if (h) parts.push(unit(h, "hour"));
    if (m) parts.push(unit(m, "minute"));
    return parts.length ? parts.join(" ") : "less than a minute";
  };

  // Easter egg: the battery "charges" overnight (22:00-06:00) and "discharges"
  // through the day (06:00-22:00). Level and time-to-flip ramp linearly across
  // each half-cycle, meeting at 100% by 06:00 and 20% by 22:00, so the dropdown
  // tracks the wall clock instead of showing fixed numbers.
  const syncBattery = (): void => {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    const charging = hour >= 22 || hour < 6;

    const [start, length] = charging ? [22, 8] : [6, 16];
    const elapsed = (hour - start + 24) % 24; // hours into the current half-cycle
    const pct = charging
      ? 20 + (elapsed / length) * 80
      : 100 - (elapsed / length) * 80;
    const detail = `About ${fmtDuration((length - elapsed) * 60)} ${charging ? "until full" : "remaining"}`;
    const level = Math.round(pct);

    toggleGlyphPair(batGlyphs, "data-bat-glyph-charging", charging);
    if (batHeadline) batHeadline.textContent = `${level}% — ${charging ? "charging" : "discharging"}`;
    if (batDetail) batDetail.textContent = detail;
    if (batFill) batFill.style.width = `${level}%`;

    // Step the glyph fill in discrete 20% increments so the icon visibly drains
    // through the day and fills back up overnight.
    const step = Math.round(level / 20) * 20;
    const fillWidth = ((step / 100) * BAT_GLYPH_FILL_MAX).toFixed(2);
    for (const r of batLevelFills) r.setAttribute("width", fillWidth);
  };

  syncClockMode();
  syncBattery();
  setInterval(() => {
    tickClock();
    syncBattery();
  }, 30 * 1000);
  narrowMQ.addEventListener("change", syncClockMode);

  const triggers = Array.from(
    panel.querySelectorAll<HTMLElement>("[data-panel-trigger][data-menu], [data-panel-trigger][data-indicator]"),
  );
  const dropdownByTrigger = new Map<HTMLElement, HTMLElement>();
  for (const t of triggers) {
    const drop = t.parentElement?.querySelector<HTMLElement>("[data-dropdown-for]");
    if (drop) dropdownByTrigger.set(t, drop);
  }

  let openTrigger: HTMLElement | null = null;
  let openDropdown: HTMLElement | null = null;

  const closeOpen = (): void => {
    if (!openTrigger || !openDropdown) return;
    openDropdown.hidden = true;
    openTrigger.classList.remove("is-open");
    openTrigger = null;
    openDropdown = null;
  };

  const openTriggerEl = (trig: HTMLElement): void => {
    const drop = dropdownByTrigger.get(trig);
    if (!drop) return;
    if (openTrigger === trig) { closeOpen(); return; }
    closeOpen();
    drop.hidden = false;
    trig.classList.add("is-open");
    openTrigger = trig;
    openDropdown = drop;
    if (trig.dataset.indicator === "clock") {
      const now = new Date();
      if (clockLongDate) clockLongDate.textContent = fmtLongDate(now);
      if (calendarHost) renderCalendar(calendarHost, now);
    }
  };

  for (const t of triggers) {
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      openTriggerEl(t);
    });
  }

  document.addEventListener("click", (e) => {
    if (!openTrigger) return;
    const target = e.target as Element | null;
    if (!target) return;
    if (target.closest("[data-panel-trigger]")) return;
    if (target.closest("[data-flyout-keepopen]")) return;
    closeOpen();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openTrigger) closeOpen();
  });

  const vol = { level: 62, muted: false };
  const slider = panel.querySelector<HTMLInputElement>("[data-vol-slider]");
  const readout = panel.querySelector<HTMLElement>("[data-vol-readout]");
  const volGlyphs = Array.from(panel.querySelectorAll<HTMLElement>("[data-vol-glyph]"));

  const syncVolUI = (): void => {
    toggleGlyphPair(volGlyphs, "data-vol-glyph-mute", vol.muted);
    if (slider) slider.value = String(vol.muted ? 0 : vol.level);
    if (readout) readout.textContent = vol.muted ? "—" : String(vol.level);
  };

  slider?.addEventListener("input", () => {
    vol.level = Number(slider.value);
    vol.muted = false;
    syncVolUI();
  });

  panel.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    if (!target) return;
    const netRow = target.closest<HTMLElement>(".up-net-row");
    if (netRow && panel.contains(netRow)) {
      closeOpen();
      void netClick(netRow);
      return;
    }
    const actionEl = target.closest<HTMLElement>("[data-action]");
    if (!actionEl || !panel.contains(actionEl)) return;
    if (actionEl.classList.contains("is-disabled")) return;
    const action = actionEl.dataset.action;
    if (!action) return;
    if (action === "vol-toggle") {
      vol.muted = !vol.muted;
      syncVolUI();
      return;
    }
    closeOpen();
    void dispatchAction(action);
  });

  syncVolUI();
  syncTitle();
}
