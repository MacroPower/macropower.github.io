import { subscribe, getTrashFocused, getStudioFocused } from "./focus";
import { WINDOW_STATE_EVENT } from "./page-window";
import { showPreferences, setReduceMotion } from "./prefs";
import { showShortcuts } from "./shortcuts";
import { showLock } from "./lock";
import { openStudio } from "./daw";
import * as audio from "./audio";
import type { UPDialogOptions, UPPageWindowState, UPSite } from "./types";

const LAUNCHER_URLS: Record<string, string> = {
  cv: "/cv/",
  blog: "/posts/",
  projects: "/projects/",
  sponsors: "/sponsors/",
  icons: "/icons/",
};

const EMPTY_SITE: UPSite = { handle: "", github: "", repo: "", rss: "" };
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
  "dlg:github": (site) => {
    const url = site.repo;
    if (!url) {
      return {
        icon: "info", title: "Source",
        body: "This is a personal site.",
        buttons: [{ id: "ok", label: "OK", primary: true }],
      };
    }
    return {
      icon: "info", title: "Source",
      render: (content) => {
        const p = document.createElement("p");
        p.className = "up-dlg-content-body";
        p.append("This is a personal site living at ");
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = url.replace(/^https?:\/\//, "");
        p.append(a, ".");
        content.appendChild(p);
      },
      buttons: [{ id: "ok", label: "OK", primary: true }],
    };
  },
  "dlg:cal": () => ({ icon: "info", title: "Calendar",
    body: "No events today. The next thing on the calendar is a haircut next Tuesday." }),
};

function fmtDuration(mins: number): string {
  const t = Math.round(mins);
  const h = Math.floor(t / 60);
  const m = t % 60;
  const unit = (n: number, u: string): string => `${n} ${u}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (h) parts.push(unit(h, "hour"));
  if (m) parts.push(unit(m, "minute"));
  return parts.length ? parts.join(" ") : "less than a minute";
}

interface SimBattery {
  level: number;
  charging: boolean;
  detail: string;
}

// Easter egg: the battery "charges" overnight (22:00-06:00) and "discharges"
// through the day (06:00-22:00). Level and time-to-flip ramp linearly across
// each half-cycle, meeting at 100% by 06:00 and 20% by 22:00, so the dropdown
// tracks the wall clock instead of showing fixed numbers. Shared by the panel
// glyph sync and the Power settings dialog's fallback path.
function computeSimBattery(now: Date): SimBattery {
  const hour = now.getHours() + now.getMinutes() / 60;
  const charging = hour >= 22 || hour < 6;
  const [start, length] = charging ? [22, 8] : [6, 16];
  const elapsed = (hour - start + 24) % 24; // hours into the current half-cycle
  const pct = charging
    ? 20 + (elapsed / length) * 80
    : 100 - (elapsed / length) * 80;
  const detail = `About ${fmtDuration((length - elapsed) * 60)} ${charging ? "until full" : "remaining"}`;
  return { level: Math.round(pct), charging, detail };
}

interface BatteryManager {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
}

// Shape of the Network Information API's `navigator.connection`, which the lib
// config doesn't type. Every field is optional: Chromium exposes them, but
// Firefox/Safari omit `connection` entirely. Mirrors the BatteryManager shim.
interface NetworkInformation {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
  type?: string;
}

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

async function showTime(): Promise<void> {
  const opts = Intl.DateTimeFormat().resolvedOptions();
  const offMin = new Date().getTimezoneOffset(); // minutes; positive when behind UTC
  const sign = offMin <= 0 ? "+" : "-";
  const abs = Math.abs(offMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const localTime = new Date().toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  await dlg({
    icon: "info", title: "Time & date",
    body: `Time zone: ${opts.timeZone} (UTC${sign}${hh}:${mm})`,
    details: `Locale: ${opts.locale}\nLocal time: ${localTime}`,
  });
}

async function showPower(): Promise<void> {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
  if (nav.getBattery) {
    try {
      const bat = await nav.getBattery();
      const level = Math.round(bat.level * 100);
      let line: string;
      if (bat.charging) {
        line = Number.isFinite(bat.chargingTime) && bat.chargingTime > 0
          ? `About ${fmtDuration(bat.chargingTime / 60)} until full`
          : "Fully charged";
      } else {
        line = Number.isFinite(bat.dischargingTime) && bat.dischargingTime > 0
          ? `About ${fmtDuration(bat.dischargingTime / 60)} remaining`
          : "Estimating time remaining…";
      }
      await dlg({
        icon: "info", title: "Power settings",
        body: `Battery: ${level}% — ${bat.charging ? "charging" : "on battery"}`,
        details: `${line}\nReported by the Battery Status API.`,
      });
      return;
    } catch {
      // Permission denied or unavailable; fall through to the simulation.
    }
  }
  const sim = computeSimBattery(new Date());
  await dlg({
    icon: "info", title: "Power settings",
    body: `Battery: ${sim.level}% — ${sim.charging ? "charging" : "discharging"}`,
    details: `${sim.detail}\nThe raw data lives in /sys/class/power_supply/BAT0/uevent.`,
  });
}

async function showWired(): Promise<void> {
  const nav = navigator as Navigator & { connection?: NetworkInformation };
  const conn = nav.connection;
  if (conn && (conn.effectiveType || conn.downlink != null || conn.rtt != null)) {
    const wired = conn.type === "ethernet";
    const lines: string[] = [];
    if (conn.effectiveType) lines.push(`Effective type: ${conn.effectiveType}`);
    if (conn.downlink != null) lines.push(`Downlink: ~${conn.downlink} Mbps`);
    if (conn.rtt != null) lines.push(`Round-trip time: ${conn.rtt} ms`);
    if (conn.type) lines.push(`Type: ${conn.type}`);
    lines.push(`Data saver: ${conn.saveData ? "on" : "off"}`);
    lines.push("Reported by the Network Information API.");
    await dlg({
      icon: "info",
      title: wired ? "Wired connection" : "Connection details",
      body: wired
        ? "Ethernet link is up."
        : "No wired link, but here's what the browser will tell us:",
      details: lines.join("\n"),
    });
    return;
  }
  // Firefox/Safari don't expose navigator.connection; report the one real bit
  // we do have — online/offline — with a playful nod to the missing details.
  const online = navigator.onLine;
  await dlg({
    icon: online ? "info" : "warning",
    title: online ? "Connection details" : "You're offline",
    body: online
      ? "You're online, but this browser won't admit over what. No cable, no Mbps, no secrets."
      : "No connection detected. Check the cable nobody can see.",
  });
}

async function showSubscribe(site: UPSite): Promise<void> {
  const url = site.rss;
  if (!url) {
    await dlg({ icon: "info", title: "Subscribe to feed",
      body: "This site doesn't expose an RSS feed." });
    return;
  }
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      copied = true;
    }
  } catch {
    // Clipboard can reject (denied permission / insecure origin); show the URL.
    copied = false;
  }
  const r = await dlg({
    icon: copied ? "success" : "info",
    title: "Subscribe to feed",
    body: copied
      ? `Copied ${url} — paste it into your reader.`
      : `Feed URL: ${url}`,
    buttons: [
      { id: "close", label: "Close" },
      { id: "open", label: "Open feed", primary: true },
    ],
  });
  if (r === "open") window.open(url, "_blank", "noopener");
}

// In-memory hotspot state. Toggling mutates the SSR net indicator + dropdown
// directly (dispatchAction has no panel ref); session-only.
const hotspot = { active: false };

async function handleHotspot(): Promise<void> {
  const indicator = document.querySelector<HTMLElement>('[data-indicator="net"]');
  const body = document.querySelector<HTMLElement>('[data-dropdown-for="net"] .up-dropdown-body');
  const trigger = document.querySelector<HTMLElement>('[data-action="dlg:hotspot"]');

  if (hotspot.active) {
    hotspot.active = false;
    indicator?.classList.remove("is-hotspot");
    body?.querySelector("[data-hotspot-status]")?.remove();
    if (trigger) trigger.textContent = "Enable hotspot";
    await dlg({ icon: "info", title: "Hotspot disabled",
      body: "Wi-Fi hotspot turned off. Other devices can no longer share this connection." });
    return;
  }

  const r = await dlg({
    icon: "question", title: "Enable Wi-Fi hotspot?",
    body: "Other devices will be able to share this connection. Estimated battery cost: significant.",
    buttons: [
      { id: "cancel", label: "Cancel" },
      { id: "on", label: "Enable hotspot", primary: true },
    ],
  });
  if (r !== "on") return;

  hotspot.active = true;
  indicator?.classList.add("is-hotspot");
  if (trigger) trigger.textContent = "Disable hotspot";
  if (body) {
    const status = document.createElement("div");
    status.className = "up-dropdown-row is-hotspot-status";
    status.setAttribute("data-hotspot-status", "");
    status.textContent = "Hotspot active · personal-site (2 devices)";
    body.insertBefore(status, body.firstChild);
  }
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
  if (action === "daw:open") {
    openStudio();
    return;
  }
  if (action === "dlg:lock") {
    showLock();
    return;
  }
  if (action === "dlg:prefs") {
    await showPreferences();
    return;
  }
  if (action === "dlg:shortcuts") {
    await showShortcuts();
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
  if (action === "dlg:time") { await showTime(); return; }
  if (action === "dlg:power") { await showPower(); return; }
  if (action === "dlg:wired") { await showWired(); return; }
  if (action === "dlg:subscribe") { await showSubscribe(site); return; }
  if (action === "dlg:hotspot") { await handleHotspot(); return; }
  if (action === "dlg:logout") {
    const r = await dlg({
      icon: "question", title: "Log out of " + (site.handle || "user") + "?",
      body: "All unsaved windows will be closed and you'll be returned to the login screen.",
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "out", label: "Log out", primary: true, danger: true },
      ],
    });
    // Drop to the greeter; "signing in" reloads a fresh session.
    if (r === "out") showLock({ onUnlock: () => { window.location.reload(); } });
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
  if (panel.dataset.volPlaylist) {
    try {
      audio.configure(JSON.parse(panel.dataset.volPlaylist) as string[]);
    } catch {
      // Malformed playlist attribute; the player just stays unconfigured.
    }
  }
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
    if (getStudioFocused()) { setTitle("Studio"); return; }
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

  const syncBattery = (): void => {
    const { level, charging, detail } = computeSimBattery(new Date());

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
    // If focus is about to be hidden along with the dropdown, hand it back to
    // the trigger so keyboard users aren't dumped at the top of the document.
    const refocus = openDropdown.contains(document.activeElement) ? openTrigger : null;
    openDropdown.hidden = true;
    openTrigger.classList.remove("is-open");
    openTrigger.setAttribute("aria-expanded", "false");
    openTrigger = null;
    openDropdown = null;
    refocus?.focus();
  };

  const openTriggerEl = (trig: HTMLElement): void => {
    const drop = dropdownByTrigger.get(trig);
    if (!drop) return;
    if (openTrigger === trig) { closeOpen(); return; }
    closeOpen();
    drop.hidden = false;
    trig.classList.add("is-open");
    trig.setAttribute("aria-expanded", "true");
    openTrigger = trig;
    openDropdown = drop;
    if (trig.dataset.indicator === "clock") {
      const now = new Date();
      if (clockLongDate) clockLongDate.textContent = fmtLongDate(now);
      if (calendarHost) renderCalendar(calendarHost, now);
    }
  };

  // Every natively-focusable control inside a dropdown, in DOM order: the
  // action rows are <button>s, plus the inbox Compose link and the volume
  // dropdown's slider — all of them participate in the arrow-key roving.
  const dropdownItems = (drop: HTMLElement): HTMLElement[] =>
    Array.from(drop.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled])",
    ));

  const moveDropdownFocus = (drop: HTMLElement, dir: 1 | -1): void => {
    const items = dropdownItems(drop);
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const next = idx === -1
      ? (dir === 1 ? items[0] : items[items.length - 1])
      : items[(idx + dir + items.length) % items.length];
    next?.focus();
  };

  for (const t of triggers) {
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = openTrigger === t;
      openTriggerEl(t);
      // A keyboard "click" (Enter/Space on the button) reports detail 0;
      // opening that way moves focus straight to the first dropdown item.
      if (!wasOpen && e.detail === 0 && openDropdown) moveDropdownFocus(openDropdown, 1);
    });
  }

  panel.addEventListener("keydown", (e) => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (!target) return;
    if (e.key === "ArrowDown" && dropdownByTrigger.has(target)) {
      e.preventDefault();
      if (openTrigger !== target) openTriggerEl(target);
      if (openDropdown) moveDropdownFocus(openDropdown, 1);
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && openDropdown?.contains(target)) {
      e.preventDefault();
      moveDropdownFocus(openDropdown, e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    // Left/Right walk the adjacent top-level triggers while a menu is open,
    // GTK-style — except on the volume slider, where they adjust the value.
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && openTrigger
        && !(target instanceof HTMLInputElement)) {
      const visible = triggers.filter((t) => t.offsetParent !== null);
      const idx = visible.indexOf(openTrigger);
      if (idx === -1) return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = visible[(idx + dir + visible.length) % visible.length];
      if (next && next !== openTrigger) {
        openTriggerEl(next);
        next.focus();
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!openTrigger) return;
    const target = e.target as Element | null;
    if (!target) return;
    if (target.closest("[data-panel-trigger]")) return;
    if (target.closest("[data-flyout-keepopen]")) return;
    closeOpen();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !openTrigger) return;
    const trig = openTrigger;
    closeOpen();
    trig.focus();
  });

  const vol = { level: 62, muted: false };
  const slider = panel.querySelector<HTMLInputElement>("[data-vol-slider]");
  const readout = panel.querySelector<HTMLElement>("[data-vol-readout]");
  const volGlyphs = Array.from(panel.querySelectorAll<HTMLElement>("[data-vol-glyph]"));
  const playGlyphs = Array.from(panel.querySelectorAll<HTMLElement>("[data-vol-play-glyph]"));
  const playBtn = panel.querySelector<HTMLElement>(".up-vol-play");
  const nowPlaying = panel.querySelector<HTMLElement>("[data-vol-nowplaying]");

  // The label only ever shows the anonymous "Track N" — which track is which
  // is a surprise. Paused still names the selection so the next-track button
  // gives visible feedback before anything plays.
  const syncNowPlaying = (): void => {
    if (!nowPlaying) return;
    const name = audio.trackName();
    if (!audio.isPlaying()) {
      nowPlaying.textContent = name ? `${name} — paused` : "Paused";
      return;
    }
    nowPlaying.textContent = vol.muted ? `${name} (muted)` : name;
  };

  const syncPlayUI = (isPlaying: boolean): void => {
    toggleGlyphPair(playGlyphs, "data-vol-play-glyph-playing", isPlaying);
    playBtn?.classList.toggle("is-playing", isPlaying);
    syncNowPlaying();
  };

  // Keeps the now-playing label in sync too, so callers never have to remember
  // the pairing (the mute/volume readout and the label both reflect `vol`).
  const syncVolUI = (): void => {
    toggleGlyphPair(volGlyphs, "data-vol-glyph-mute", vol.muted);
    if (slider) slider.value = String(vol.muted ? 0 : vol.level);
    if (readout) readout.textContent = vol.muted ? "—" : String(vol.level);
    syncNowPlaying();
  };

  slider?.addEventListener("input", () => {
    vol.level = Number(slider.value);
    vol.muted = false;
    audio.setVolume(vol.level);
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
      audio.setMuted(vol.muted);
      syncVolUI();
      return;
    }
    if (action === "vol-play") {
      void audio.toggle();
      return;
    }
    if (action === "vol-next") {
      // Like vol-play, handled without closing the dropdown so you can flip
      // through the playlist; the label updates via audio.onChange.
      void audio.selectTrack(audio.trackIndex() + 1);
      return;
    }
    closeOpen();
    void dispatchAction(action);
  });

  // Play state flows through the audio module's pub/sub (not the toggle()
  // promise) so the Studio transport and this panel always agree, whichever
  // one started or stopped playback.
  audio.onChange(() => syncPlayUI(audio.isPlaying()));

  syncVolUI();
  syncTitle();
}
