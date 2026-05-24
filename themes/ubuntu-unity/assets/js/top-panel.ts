import { subscribe, getTrashFocused } from "./focus";
import { WINDOW_STATE_EVENT } from "./page-window";
import type { UPDialogOptions, UPPageWindowState, UPSite } from "./types";

const LAUNCHER_URLS: Record<string, string> = {
  about: "/about/",
  cv: "/cv/",
  blog: "/posts/",
  contact: "/contact/",
};

const EMPTY_SITE: UPSite = { handle: "", github: "", rss: "" };
const getSite = (): UPSite => window.UP_SITE ?? EMPTY_SITE;

function navigate(key: string): void {
  const url = LAUNCHER_URLS[key];
  if (url) window.location.href = url;
}

function dlg(opts: UPDialogOptions): Promise<string | null> {
  return window.uiDialog?.(opts) ?? Promise.resolve<string | null>(null);
}

const desktopTitle = "Ubuntu";

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

function dispatchAction(action: string): void {
  if (action.startsWith("nav:")) {
    navigate(action.slice(4));
    return;
  }
  if (action === "reload") { window.location.reload(); return; }
  if (action === "fullscreen") {
    void document.documentElement.requestFullscreen?.().catch(() => {});
    return;
  }
  const site = getSite();
  switch (action) {
    case "dlg:prefs":
      void dlg({ icon: "info", title: "Preferences",
        body: "This site doesn't ship a settings panel." });
      return;
    case "dlg:launcher-info":
      void dlg({ icon: "info", title: "Launcher is always shown",
        body: "The launcher is part of the shell." });
      return;
    case "dlg:shortcuts":
      void dlg({
        icon: "info", title: "Keyboard shortcuts",
        body: "A few shortcuts work across the desktop:",
        details: "Ctrl+W       close the focused window\nEsc           dismiss menus and dialogs\nDrag titlebar to reposition any window or dialog.",
      });
      return;
    case "dlg:github":
      void dlg({
        icon: "info", title: "Source",
        body: site.github
          ? "This is a personal site living at " + site.github + "."
          : "This is a personal site.",
        buttons: [{ id: "ok", label: "OK", primary: true }],
      });
      return;
    case "dlg:subscribe":
      void dlg({
        icon: "success", title: "Subscribed",
        body: site.rss
          ? "Pretend-subscribed to " + site.rss + ". Drop the URL into your reader of choice."
          : "Pretend-subscribed. Drop the feed URL into your reader of choice.",
      });
      return;
    case "dlg:wired":
      void dlg({ icon: "warning", title: "No wired connection",
        body: "No ethernet cable detected. Plug one in to use a wired network." });
      return;
    case "dlg:hotspot":
      void dlg({
        icon: "question", title: "Enable Wi-Fi hotspot?",
        body: "Other devices will be able to share this connection. Estimated battery cost: significant.",
        buttons: [
          { id: "cancel", label: "Cancel" },
          { id: "on", label: "Enable hotspot", primary: true },
        ],
      });
      return;
    case "dlg:power-saver":
      void dlg({ icon: "success", title: "Power saver enabled",
        body: "Screen will dim after 1 minute. Background tasks throttled." });
      return;
    case "dlg:power":
      void dlg({ icon: "info", title: "Power settings",
        body: "The System Settings panel isn't wired up in this build. The raw data lives in /sys/class/power_supply/BAT0/uevent." });
      return;
    case "dlg:cal":
      void dlg({ icon: "info", title: "Calendar",
        body: "No events today. The next thing on the calendar is a haircut next Tuesday." });
      return;
    case "dlg:time":
      void dlg({ icon: "info", title: "Time & date",
        body: "Time zone: Europe/Lisbon (WEST, UTC+1). Synced via NTP." });
      return;
    case "dlg:lock":
      void dlg({ icon: "info", title: "Lock screen",
        body: "Just kidding — there's nothing to lock. This is a website." });
      return;
    case "dlg:logout":
      void (async () => {
        const r = await dlg({
          icon: "question", title: "Log out of " + (site.handle || "user") + "?",
          body: "All unsaved windows will be closed. You can sign back in by reloading the page.",
          buttons: [
            { id: "cancel", label: "Cancel" },
            { id: "out", label: "Log out", primary: true, danger: true },
          ],
        });
        if (r === "out") window.location.reload();
      })();
      return;
  }
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

  const initialPageTitle = (titleSlot?.textContent ?? "").trim();
  let pageTitle = initialPageTitle;
  let winVisible = window.UP_PAGE_WINDOW_STATE?.visible !== false;

  const setTitle = (text: string): void => {
    if (titleSlot) titleSlot.textContent = text;
  };

  const syncTitle = (): void => {
    if (getTrashFocused()) { setTitle("Trash"); return; }
    setTitle(winVisible ? pageTitle : desktopTitle);
  };

  window.addEventListener(WINDOW_STATE_EVENT, (e) => {
    const detail = (e as CustomEvent<UPPageWindowState>).detail;
    winVisible = Boolean(detail.visible);
    syncTitle();
  });
  subscribe(syncTitle);

  /* ----- clock ---------------------------------------------------------- */

  const narrowMQ = window.matchMedia("(max-width: 560px)");
  const tickClock = (): void => {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    const date = now.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    if (clockWide) clockWide.textContent = `${date}  ${time}`;
    if (clockNarrow) clockNarrow.textContent = time;
    if (clockLongDate) {
      clockLongDate.textContent = now.toLocaleDateString([],
        { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }
  };
  const syncClockMode = (): void => {
    if (clockWide) clockWide.hidden = narrowMQ.matches;
    if (clockNarrow) clockNarrow.hidden = !narrowMQ.matches;
  };
  syncClockMode();
  tickClock();
  setInterval(tickClock, 30 * 1000);
  narrowMQ.addEventListener("change", syncClockMode);

  /* ----- dropdown open/close ------------------------------------------- */

  const triggers = Array.from(
    panel.querySelectorAll<HTMLElement>("[data-panel-trigger][data-menu], [data-panel-trigger][data-indicator]"),
  );
  let openTrigger: HTMLElement | null = null;
  let openDropdown: HTMLElement | null = null;

  const dropdownFor = (trig: HTMLElement): HTMLElement | null => {
    const wrap = trig.parentElement;
    return wrap?.querySelector<HTMLElement>("[data-dropdown-for]") ?? null;
  };

  const closeOpen = (): void => {
    if (!openTrigger || !openDropdown) return;
    openDropdown.hidden = true;
    openTrigger.classList.remove("is-open");
    openTrigger = null;
    openDropdown = null;
  };

  const openTriggerEl = (trig: HTMLElement): void => {
    const drop = dropdownFor(trig);
    if (!drop) return;
    if (openTrigger === trig) { closeOpen(); return; }
    closeOpen();
    drop.hidden = false;
    trig.classList.add("is-open");
    openTrigger = trig;
    openDropdown = drop;
    if (trig.dataset.indicator === "clock" && calendarHost) {
      renderCalendar(calendarHost, new Date());
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

  /* ----- action dispatch ----------------------------------------------- */

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
    dispatchAction(action);
  });

  /* ----- volume slider -------------------------------------------------- */

  const vol = { level: 62, muted: false };
  const slider = panel.querySelector<HTMLInputElement>("[data-vol-slider]");
  const readout = panel.querySelector<HTMLElement>("[data-vol-readout]");
  const volGlyphs = Array.from(panel.querySelectorAll<HTMLElement>("[data-vol-glyph]"));

  const syncVolUI = (): void => {
    for (const g of volGlyphs) {
      const isMuteGlyph = g.hasAttribute("data-vol-glyph-mute");
      g.hidden = isMuteGlyph ? !vol.muted : vol.muted;
    }
    if (slider) slider.value = String(vol.muted ? 0 : vol.level);
    if (readout) readout.textContent = vol.muted ? "—" : String(vol.level);
  };

  slider?.addEventListener("input", () => {
    vol.level = Number(slider.value);
    vol.muted = false;
    syncVolUI();
  });

  syncVolUI();
  syncTitle();
}
