// The Unity HUD — "menus you type to". A plain Alt tap (chords cancel, so
// Alt+Tab / Alt+B / emacs bindings in the terminal are untouched) opens a
// search box that fuzzy-matches every actionable entry in the top panel's
// menus and indicator dropdowns, and Enter runs the selected one through the
// exact same dispatch path a mouse click would take. The index is rebuilt on
// every open, so runtime menu mutations (the hotspot row flipping between
// Enable and Disable, a Wi-Fi network becoming the connected one) are always
// current. Open/close mechanics, reduce-motion, and the tap detector all
// mirror dash.ts — the Dash and the HUD are siblings and should feel it.
//
// Unlike the Dash's real-focus tile grid, the HUD keeps focus in the input
// and drives a virtual selection (aria-activedescendant over role=option
// rows), which is how Unity's HUD behaved: arrows move the highlight, typing
// keeps flowing into the query.

import { dispatchAction } from "./top-panel";
import { isReduceMotion } from "./prefs";

const MAX_RESULTS = 5;

interface HudItem {
  /** Menu path shown dim before the label ("File", "Network", ...). */
  menu: string;
  label: string;
  /** Lowercased haystacks, precomputed at index time. */
  labelLc: string;
  fullLc: string;
  exec: () => void;
}

// Subsequence test: every char of `q` appears in `hay` in order. This is the
// loose end of the ranking — "ohl" still finds "Open hotspot link" — while
// prefix/substring hits rank far above it.
function subseq(q: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return q.length === 0;
}

// Lower is better; null = no match. Tokens all have to land somewhere.
function score(item: HudItem, tokens: string[]): number | null {
  let total = 0;
  for (const t of tokens) {
    if (item.labelLc.startsWith(t)) total += 0;
    else if (item.labelLc.includes(t)) total += 1;
    else if (item.fullLc.includes(t)) total += 2;
    else if (subseq(t, item.labelLc)) total += 3;
    else if (subseq(t, item.fullLc)) total += 4;
    else return null;
  }
  return total;
}

export function initHud(): void {
  const root = document.querySelector<HTMLElement>("[data-up-hud]");
  if (!root) return;
  const panel = root.querySelector<HTMLElement>(".up-hud-panel");
  const input = root.querySelector<HTMLInputElement>("[data-hud-input]");
  const list = root.querySelector<HTMLElement>("[data-hud-results]");
  const statusEl = root.querySelector<HTMLElement>("[data-hud-status]");
  const backdrop = root.querySelector<HTMLElement>("[data-hud-backdrop]");
  if (!panel || !input || !list) return;

  let visible = false;
  let opener: HTMLElement | null = null;
  let items: HudItem[] = [];
  let shown: HudItem[] = [];
  let selected = 0;

  // ---- Menu indexing -------------------------------------------------------

  const rowLabel = (el: HTMLElement): string =>
    (el.querySelector(".up-menu-item-label")?.textContent ?? el.textContent ?? "").trim();

  const buildIndex = (): HudItem[] => {
    const out: HudItem[] = [];
    const push = (menu: string, label: string, exec: () => void): void => {
      if (!label) return;
      out.push({
        menu,
        label,
        labelLc: label.toLowerCase(),
        fullLc: `${menu} ${label}`.toLowerCase(),
        exec,
      });
    };
    const panel = document.querySelector<HTMLElement>(".up-top-panel[data-ssr]");
    if (!panel) return out;
    for (const trigger of Array.from(panel.querySelectorAll<HTMLElement>("[data-panel-trigger]"))) {
      const key = trigger.dataset.menu ?? trigger.dataset.indicator;
      if (!key) continue;
      const dropdown = panel.querySelector<HTMLElement>(`[data-dropdown-for="${key}"]`);
      if (!dropdown) continue;
      // Menubar triggers are labeled by their text, indicators by aria-label.
      const menu = trigger.dataset.menu
        ? (trigger.textContent ?? "").trim()
        : trigger.getAttribute("aria-label") ?? key;
      for (const el of Array.from(
        dropdown.querySelectorAll<HTMLElement>("button[data-action], a.up-dropdown-btn[href]"),
      )) {
        if (el.hasAttribute("disabled")) continue;
        const action = el.dataset.action;
        // Icon-only controls (mute toggle, transport) have no text to type.
        push(menu, rowLabel(el), action ? () => { void dispatchAction(action); } : () => el.click());
      }
      // Wi-Fi rows have no data-action — connecting is a click on the row
      // (top-panel.ts owns the semantics); skip the one already connected.
      for (const net of Array.from(
        dropdown.querySelectorAll<HTMLButtonElement>("button[data-net-name]:not([data-net-on])"),
      )) {
        push(menu, `Connect to ${net.dataset.netName ?? ""}`, () => net.click());
      }
    }
    return out;
  };

  // ---- Rendering -----------------------------------------------------------

  const syncSelection = (): void => {
    const rows = Array.from(list.children) as HTMLElement[];
    rows.forEach((row, i) => {
      row.classList.toggle("is-selected", i === selected);
      row.setAttribute("aria-selected", i === selected ? "true" : "false");
    });
    input.setAttribute("aria-activedescendant", rows[selected]?.id ?? "");
  };

  const render = (): void => {
    const q = input.value.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      shown = [];
    } else {
      shown = items
        .map((item, i) => ({ item, i, s: score(item, tokens) }))
        .filter((r): r is { item: HudItem; i: number; s: number } => r.s !== null)
        .sort((a, b) => a.s - b.s || a.i - b.i)
        .slice(0, MAX_RESULTS)
        .map((r) => r.item);
    }
    selected = 0;
    list.replaceChildren(
      ...shown.map((item, i) => {
        const li = document.createElement("li");
        li.className = "up-hud-row";
        li.id = `up-hud-opt-${i}`;
        li.setAttribute("role", "option");
        const path = document.createElement("span");
        path.className = "up-hud-row-path";
        path.textContent = `${item.menu} ▸ `;
        const label = document.createElement("span");
        label.className = "up-hud-row-label";
        label.textContent = item.label;
        li.append(path, label);
        li.addEventListener("click", () => run(item));
        return li;
      }),
    );
    list.classList.toggle("has-results", shown.length > 0);
    input.setAttribute("aria-expanded", shown.length ? "true" : "false");
    syncSelection();
    if (statusEl) {
      statusEl.textContent = tokens.length
        ? `${shown.length} matching command${shown.length === 1 ? "" : "s"}`
        : "";
    }
  };

  // ---- Open / close (the dash.ts overlay pattern) --------------------------

  const open = (): void => {
    if (visible) return;
    visible = true;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    items = buildIndex();
    input.value = "";
    root.hidden = false;
    render();
    // Force a reflow so removing `hidden` and adding `is-visible` animate.
    void root.offsetWidth;
    root.classList.add("is-visible");
    input.focus();
  };

  const close = (): void => {
    if (!visible) return;
    visible = false;
    const finish = (): void => {
      root.removeEventListener("transitionend", finish);
      if (!visible) root.hidden = true;
    };
    root.classList.remove("is-visible");
    if (isReduceMotion()) {
      finish();
    } else {
      root.addEventListener("transitionend", finish);
      setTimeout(finish, 300);
    }
    const target = opener?.isConnected ? opener : null;
    opener = null;
    target?.focus();
  };

  // Close first so dialogs opened by the action record the pre-HUD focus as
  // their opener (dialogs.ts restores focus there on dismiss), then run.
  const run = (item: HudItem): void => {
    close();
    item.exec();
  };

  root.addEventListener("keydown", (e) => {
    // Mid-IME-composition keys belong to the composer (Enter commits the
    // candidate, arrows navigate it); hijacking them would eat the input.
    if (e.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (input.value) {
        input.value = "";
        render();
        input.focus();
      } else {
        close();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown.length) return;
      selected = (selected + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
      syncSelection();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = shown[selected];
      if (item) run(item);
      return;
    }
    // The input is the HUD's only stop; keep focus parked on it.
    if (e.key === "Tab") e.preventDefault();
  });

  input.addEventListener("input", render);
  backdrop?.addEventListener("pointerdown", close);

  // Click-away: launcher / panel clicks land above the backdrop entirely
  // (z 40/50 over the HUD's 38). Capture phase, because the top panel's menu
  // triggers stopPropagation() on their clicks — in the bubble phase a
  // trigger click would open its dropdown on top of a still-open HUD instead
  // of dismissing it; closing first also lets a BFB click swap to the Dash.
  document.addEventListener("click", (e) => {
    if (!visible) return;
    const target = e.target as Element | null;
    if (!target || panel.contains(target)) return;
    close();
  }, true);

  // ---- Alt tap -------------------------------------------------------------
  // A *plain* Alt tap (no other key while held) toggles the HUD, Unity's
  // signature binding. Chords (Alt+Tab, Alt+F4, the terminal's Alt+B/F)
  // cancel the tap. preventDefault on the keyup also keeps Firefox from
  // activating its menubar on the released Alt.
  let altTap = false;

  const blocked = (): boolean => {
    const lock = document.querySelector<HTMLElement>("[data-up-lock]");
    if (lock && !lock.hidden) return true;
    const host = document.getElementById("up-dialog-host");
    if (host && host.childElementCount > 0) return true;
    // The Dash and the HUD are mutually exclusive overlays.
    const dash = document.querySelector<HTMLElement>("[data-up-dash]");
    return Boolean(dash && !dash.hidden);
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === "Alt") {
      // OS key auto-repeat (Windows repeats modifiers) must not cancel a
      // held tap, and Alt landing on an already-held modifier is a chord
      // (Shift+Alt switches keyboard layouts), not a tap.
      if (e.repeat) return;
      altTap = (visible || !blocked()) && !e.ctrlKey && !e.shiftKey && !e.metaKey;
      return;
    }
    altTap = false;
  }, true);
  window.addEventListener("keyup", (e) => {
    if (e.key !== "Alt" || !altTap) return;
    altTap = false;
    e.preventDefault();
    e.stopPropagation();
    if (visible) close();
    else open();
  }, true);
  window.addEventListener("pointerdown", () => { altTap = false; }, true);
  window.addEventListener("blur", () => { altTap = false; });
}
