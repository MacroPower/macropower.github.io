import { subscribe, getTrashFocused, getStudioFocused } from "./focus";
import { locale, t, tn } from "./i18n";
import { WINDOW_STATE_EVENT } from "./page-window";
import { notify, notifyValue } from "./notify";
import { showPreferences, setReduceMotion } from "./prefs";
import { showShortcuts } from "./shortcuts";
import { showLock } from "./lock";
import { openStudio } from "./daw";
import * as audio from "./audio";
import type { UPDialogOptions, UPPageWindowState, UPSite } from "./types";

const EMPTY_SITE: UPSite = { handle: "", github: "", repo: "", rss: "", nav: {} };
const getSite = (): UPSite => window.UP_SITE ?? EMPTY_SITE;

// nav:<key> targets are SSR'd into UP_SITE.nav from the site-pages.html
// registry, so the URL map lives in one place on the Hugo side.
function navigate(key: string): void {
  const url = getSite().nav[key];
  if (!url) {
    console.warn("ubuntu-unity: no launcher URL for", key);
    return;
  }
  window.location.href = url;
}

function dlg(opts: UPDialogOptions): Promise<string | null> {
  return window.uiDialog?.(opts) ?? Promise.resolve<string | null>(null);
}

// Stands in for the link in the translated "living at {link}" sentence, so the
// sentence stays one string and the anchor lands wherever the language puts it.
const LINK_SLOT = "\u0000";

const DLG_PRESETS: Record<string, (site: UPSite) => UPDialogOptions> = {
  "dlg:launcher-info": () => ({ icon: "info", title: t("js_panel_launcher_title"),
    body: t("js_panel_launcher_body") }),
  "dlg:github": (site) => {
    const url = site.repo;
    if (!url) {
      return {
        icon: "info", title: t("js_panel_source_title"),
        body: t("js_panel_source_body"),
        buttons: [{ id: "ok", label: t("js_panel_ok"), primary: true }],
      };
    }
    return {
      icon: "info", title: t("js_panel_source_title"),
      render: (content) => {
        const p = document.createElement("p");
        p.className = "up-dlg-content-body";
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = url.replace(/^https?:\/\//, "");
        const [before = "", after = ""] = t("js_panel_source_body_link", { link: LINK_SLOT }).split(LINK_SLOT);
        p.append(before, a, after);
        content.appendChild(p);
      },
      buttons: [{ id: "ok", label: t("js_panel_ok"), primary: true }],
    };
  },
  "dlg:cal": () => ({ icon: "info", title: t("js_panel_cal_title"),
    body: t("js_panel_cal_body") }),
};

function fmtDuration(mins: number): string {
  const total = Math.round(mins);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) {
    return t("js_panel_hours_minutes", {
      hours: tn("js_panel_hours", h),
      minutes: tn("js_panel_minutes", m),
    });
  }
  if (h) return tn("js_panel_hours", h);
  if (m) return tn("js_panel_minutes", m);
  return t("js_panel_less_than_minute");
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
  const duration = fmtDuration((length - elapsed) * 60);
  const detail = charging
    ? t("js_panel_until_full", { duration })
    : t("js_panel_remaining", { duration });
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
  const weekdayInitials = [
    t("js_panel_cal_mon"),
    t("js_panel_cal_tue"),
    t("js_panel_cal_wed"),
    t("js_panel_cal_thu"),
    t("js_panel_cal_fri"),
    t("js_panel_cal_sat"),
    t("js_panel_cal_sun"),
  ];
  for (const d of weekdayInitials) {
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
  const localTime = new Date().toLocaleTimeString(locale(), {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  await dlg({
    icon: "info", title: t("js_panel_time_title"),
    body: t("js_panel_time_zone", { zone: opts.timeZone, offset: `${sign}${hh}:${mm}` }),
    details: [
      t("js_panel_time_locale", { locale: opts.locale }),
      t("js_panel_time_local", { time: localTime }),
    ].join("\n"),
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
          ? t("js_panel_until_full", { duration: fmtDuration(bat.chargingTime / 60) })
          : t("js_panel_fully_charged");
      } else {
        line = Number.isFinite(bat.dischargingTime) && bat.dischargingTime > 0
          ? t("js_panel_remaining", { duration: fmtDuration(bat.dischargingTime / 60) })
          : t("js_panel_estimating");
      }
      await dlg({
        icon: "info", title: t("js_panel_power_title"),
        body: bat.charging
          ? t("js_panel_battery_charging", { level })
          : t("js_panel_battery_on_battery", { level }),
        details: `${line}\n${t("js_panel_battery_api")}`,
      });
      return;
    } catch {
      // Permission denied or unavailable; fall through to the simulation.
    }
  }
  const sim = computeSimBattery(new Date());
  await dlg({
    icon: "info", title: t("js_panel_power_title"),
    body: sim.charging
      ? t("js_panel_battery_charging", { level: sim.level })
      : t("js_panel_battery_discharging", { level: sim.level }),
    details: `${sim.detail}\n${t("js_panel_battery_raw")}`,
  });
}

async function showWired(): Promise<void> {
  const nav = navigator as Navigator & { connection?: NetworkInformation };
  const conn = nav.connection;
  if (conn && (conn.effectiveType || conn.downlink != null || conn.rtt != null)) {
    const wired = conn.type === "ethernet";
    const lines: string[] = [];
    if (conn.effectiveType) lines.push(t("js_panel_net_effective_type", { value: conn.effectiveType }));
    if (conn.downlink != null) lines.push(t("js_panel_net_downlink", { value: conn.downlink }));
    if (conn.rtt != null) lines.push(t("js_panel_net_rtt", { value: conn.rtt }));
    if (conn.type) lines.push(t("js_panel_net_type", { value: conn.type }));
    lines.push(conn.saveData ? t("js_panel_net_data_saver_on") : t("js_panel_net_data_saver_off"));
    lines.push(t("js_panel_net_api"));
    await dlg({
      icon: "info",
      title: wired ? t("js_panel_wired_title") : t("js_panel_connection_details"),
      body: wired
        ? t("js_panel_ethernet_up")
        : t("js_panel_no_wired"),
      details: lines.join("\n"),
    });
    return;
  }
  // Firefox/Safari don't expose navigator.connection; report the one real bit
  // we do have — online/offline — with a playful nod to the missing details.
  const online = navigator.onLine;
  await dlg({
    icon: online ? "info" : "warning",
    title: online ? t("js_panel_connection_details") : t("js_panel_offline_title"),
    body: online
      ? t("js_panel_online_body")
      : t("js_panel_offline_body"),
  });
}

async function showSubscribe(site: UPSite): Promise<void> {
  const url = site.rss;
  if (!url) {
    await dlg({ icon: "info", title: t("js_panel_subscribe_title"),
      body: t("js_panel_no_feed") });
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
    title: t("js_panel_subscribe_title"),
    body: copied
      ? t("js_panel_feed_copied", { url })
      : t("js_panel_feed_url", { url }),
    buttons: [
      { id: "close", label: t("js_close") },
      { id: "open", label: t("js_panel_open_feed"), primary: true },
    ],
  });
  if (r === "open") window.open(url, "_blank", "noopener");
}

// In-memory hotspot state. Toggling mutates the SSR net indicator + dropdown
// directly (dispatchAction has no panel ref); session-only.
const hotspot = { active: false };

// The simulated hotspot's network name and client count.
const HOTSPOT_SSID = "personal-site";
const HOTSPOT_DEVICES = 2;

async function handleHotspot(): Promise<void> {
  const indicator = document.querySelector<HTMLElement>('[data-indicator="net"]');
  const body = document.querySelector<HTMLElement>('[data-dropdown-for="net"] .up-dropdown-body');
  const trigger = document.querySelector<HTMLElement>('[data-action="dlg:hotspot"]');

  if (hotspot.active) {
    hotspot.active = false;
    indicator?.classList.remove("is-hotspot");
    body?.querySelector("[data-hotspot-status]")?.remove();
    if (trigger) trigger.textContent = t("js_panel_enable_hotspot");
    // Passive state change, passive surface: a bubble, not a modal dialog —
    // network-manager's own manners.
    notify({ icon: "network", title: t("js_panel_hotspot_disabled_title"),
      body: t("js_panel_hotspot_disabled_body") });
    return;
  }

  const r = await dlg({
    icon: "question", title: t("js_panel_hotspot_confirm_title"),
    body: t("js_panel_hotspot_confirm_body"),
    buttons: [
      { id: "cancel", label: t("js_cancel") },
      { id: "on", label: t("js_panel_enable_hotspot"), primary: true },
    ],
  });
  if (r !== "on") return;

  hotspot.active = true;
  indicator?.classList.add("is-hotspot");
  if (trigger) trigger.textContent = t("js_panel_disable_hotspot");
  if (body) {
    const status = document.createElement("div");
    status.className = "up-dropdown-row is-hotspot-status";
    status.setAttribute("data-hotspot-status", "");
    status.textContent = tn("js_panel_hotspot_status", HOTSPOT_DEVICES, { name: HOTSPOT_SSID });
    body.insertBefore(status, body.firstChild);
  }
  notify({ icon: "network", title: t("js_panel_hotspot_active_title"),
    body: t("js_panel_hotspot_active_body", { name: HOTSPOT_SSID }) });
}

// Exported for dash.ts: the Dash's app tiles reuse the panel's action
// vocabulary (dlg:prefs, dlg:lock, dlg:logout, ...) so both surfaces always
// run the identical flow. Module-level by design — no initTopPanel state.
export async function dispatchAction(action: string): Promise<void> {
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
      icon: "success", title: t("js_panel_power_saver_title"),
      body: t("js_panel_power_saver_body"),
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
      icon: "question",
      title: t("js_panel_logout_title", { name: site.handle || t("js_panel_default_user") }),
      body: t("js_panel_logout_body"),
      buttons: [
        { id: "cancel", label: t("js_cancel") },
        { id: "out", label: t("js_panel_logout"), primary: true, danger: true },
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
    await dlg({ icon: "info", title: t("js_panel_net_already_title"),
      body: t("js_panel_net_already_body", { name }) });
    return;
  }
  const current = document.querySelector<HTMLElement>(".up-net-row[data-net-on]")?.dataset.netName;
  const r = await dlg({
    icon: "question", title: t("js_panel_net_connect_title", { name }),
    body: current
      ? t("js_panel_net_disconnect_body", { name: current })
      : t("js_panel_continue"),
    buttons: [
      { id: "cancel", label: t("js_cancel") },
      { id: "connect", label: t("js_panel_connect"), primary: true },
    ],
  });
  if (r !== "connect") return;
  if (row.hasAttribute("data-net-hidden")) {
    // The one network you can never join; the gag survives the others
    // becoming connectable.
    await dlg({
      icon: "warning", title: t("js_panel_net_failed_title"),
      body: t("js_panel_net_failed_body", { name }),
    });
    return;
  }
  // Move the connection: the ●/○ dot, is-on, is-strong (the active-AP bold),
  // and data-net-on always travel together (data-net-on is what netClick
  // itself reads back).
  for (const prev of Array.from(document.querySelectorAll<HTMLElement>(".up-net-row[data-net-on]"))) {
    prev.removeAttribute("data-net-on");
    prev.classList.remove("is-on", "is-strong");
    const dot = prev.querySelector(".up-net-row-dot");
    if (dot) dot.textContent = "○";
  }
  row.setAttribute("data-net-on", "");
  row.classList.add("is-on", "is-strong");
  const dot = row.querySelector(".up-net-row-dot");
  if (dot) dot.textContent = "●";
  // nm-applet's classic toast, verbatim phrasing.
  notify({ icon: "network", title: t("js_panel_net_established_title"),
    body: t("js_panel_net_established_body", { name }) });
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
    if (getTrashFocused()) { setTitle(t("js_panel_title_trash")); return; }
    if (getStudioFocused()) { setTitle(t("js_panel_title_studio")); return; }
    setTitle(winVisible ? pageTitle : t("js_panel_title_ubuntu"));
  };

  window.addEventListener(WINDOW_STATE_EVENT, (e) => {
    winVisible = Boolean((e as CustomEvent<UPPageWindowState>).detail.visible);
    syncTitle();
  });
  subscribe(syncTitle);

  const narrowMQ = window.matchMedia("(max-width: 560px)");
  const fmtTime = (d: Date): string =>
    d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtShortDate = (d: Date): string =>
    d.toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short" });
  const fmtLongDate = (d: Date): string =>
    d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });

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
    if (batHeadline) {
      batHeadline.textContent = charging
        ? t("js_panel_level_charging", { level })
        : t("js_panel_level_discharging", { level });
    }
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
  for (const trigger of triggers) {
    const drop = trigger.parentElement?.querySelector<HTMLElement>("[data-dropdown-for]");
    if (drop) dropdownByTrigger.set(trigger, drop);
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

  for (const trigger of triggers) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = openTrigger === trigger;
      openTriggerEl(trigger);
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
      const visible = triggers.filter((trigger) => trigger.offsetParent !== null);
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
      nowPlaying.textContent = name
        ? t("js_panel_paused_named", { name })
        : t("js_panel_paused");
      return;
    }
    nowPlaying.textContent = vol.muted ? t("js_panel_muted_named", { name }) : name;
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
    // The engine's mute flag gates its gain independently of the level;
    // without this a drag while muted unmutes the UI but not the audio.
    audio.setMuted(false);
    syncVolUI();
  });

  // Unity's sound indicator takes the scroll wheel. The change reports
  // through the synchronous notify-osd bubble, except while the sound menu
  // is open — its own slider/readout already show the level, and the bubble
  // would paint over the menu (mirroring the now-playing suppression below).
  const volTrigger = panel.querySelector<HTMLElement>('[data-indicator="vol"]');
  volTrigger?.addEventListener("wheel", (e) => {
    // Horizontal trackpad swipes (deltaY 0) are not a volume gesture; let
    // them through untouched rather than reading "not up" as "down".
    if (e.deltaY === 0) return;
    e.preventDefault();
    const step = e.deltaY < 0 ? 5 : -5;
    vol.level = Math.min(100, Math.max(0, vol.level + step));
    vol.muted = false;
    audio.setVolume(vol.level);
    audio.setMuted(false);
    syncVolUI();
    if (openTrigger?.dataset.indicator !== "vol") {
      notifyValue({ value: vol.level, icon: "volume", label: t("js_panel_volume", { level: vol.level }) });
    }
  }, { passive: false });

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
  //
  // Playback starting or switching tracks also raises the Rhythmbox-style
  // "now playing" bubble — except while the sound menu is open, where its own
  // label already says so (and the bubble would paint over the menu). A track
  // switch mid-playback emits stop+start back to back; notify()'s replace
  // semantics fold those into one bubble.
  let lastTrack = audio.trackIndex();
  let lastPlaying = audio.isPlaying();
  audio.onChange(() => {
    const playing = audio.isPlaying();
    const track = audio.trackIndex();
    syncPlayUI(playing);
    const volMenuOpen = openTrigger?.dataset.indicator === "vol";
    if (playing && (!lastPlaying || track !== lastTrack) && !volMenuOpen) {
      notify({ icon: "music", title: t("js_panel_now_playing"), body: audio.trackName() });
    }
    lastTrack = track;
    lastPlaying = playing;
  });

  syncVolUI();
  syncTitle();
}
