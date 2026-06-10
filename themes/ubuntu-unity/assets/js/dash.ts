// The Unity Dash: the translucent search overlay behind the launcher's BFB
// (the Ubuntu button) and a Super tap. Everything searchable is SSR'd into
// partials/dash.html as tiles grouped in category sections; this module only
// filters, ranks, and dispatches — it never invents content.
//
// Interaction model (GNOME-style real focus, no aria-activedescendant): the
// search input holds focus; arrows walk the visible tile grid with real DOM
// focus (tiles are tabindex="-1" so Tab stays structural: input → "See more"
// expanders → lenses); typing anywhere refocuses the input; Enter in the
// input opens the best match. Esc clears the query first, then closes —
// exactly like Unity. Session-only: query, lens, and expansion state reset
// every open.

import { openStudio } from "./daw";
import { openTrash } from "./trash";
import { dispatchAction } from "./top-panel";
import { isReduceMotion } from "./prefs";
import * as audio from "./audio";

interface DashTile {
  el: HTMLElement;
  /** Lowercased label + keywords — the substring-match haystack. */
  text: string;
  /** Lowercased label only, for ranking the Enter-on-input "best match". */
  title: string;
}

interface DashSection {
  key: string;
  root: HTMLElement;
  more: HTMLButtonElement | null;
  /** Collapsed-row size; Infinity for sections that always show everything. */
  cap: number;
  expanded: boolean;
  tiles: DashTile[];
  matches: Set<DashTile>;
  shown: number;
}

export function initDash(): void {
  const root = document.querySelector<HTMLElement>("[data-up-dash]");
  if (!root) return;
  const panel = root.querySelector<HTMLElement>(".up-dash-panel");
  const input = root.querySelector<HTMLInputElement>("[data-dash-search]");
  const results = root.querySelector<HTMLElement>("[data-dash-results]");
  const emptyEl = root.querySelector<HTMLElement>("[data-dash-empty]");
  const statusEl = root.querySelector<HTMLElement>("[data-dash-status]");
  const backdrop = root.querySelector<HTMLElement>("[data-dash-backdrop]");
  const bfb = document.querySelector<HTMLElement>("[data-dash-open]");
  const lenses = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-dash-lens]"));
  if (!panel || !input || !results) return;

  const sections: DashSection[] = Array.from(
    root.querySelectorAll<HTMLElement>("[data-dash-section]"),
  ).map((sec) => ({
    key: sec.dataset.dashSection ?? "",
    root: sec,
    more: sec.querySelector<HTMLButtonElement>("[data-dash-more]"),
    cap: sec.dataset.dashCap ? Number(sec.dataset.dashCap) : Infinity,
    expanded: false,
    tiles: Array.from(sec.querySelectorAll<HTMLElement>("[data-dash-tile]")).map((el) => {
      const label = el.querySelector(".up-dash-tile-label")?.textContent ?? "";
      return {
        el,
        title: label.trim().toLowerCase(),
        text: `${label} ${el.dataset.keywords ?? ""}`.toLowerCase(),
      };
    }),
    matches: new Set<DashTile>(),
    shown: 0,
  }));

  let visible = false;
  let lens = "home";
  let opener: HTMLElement | null = null;
  /** Best visible tile for Enter-on-input, refreshed by apply(). */
  let firstResult: HTMLElement | null = null;

  const syncLenses = (): void => {
    for (const b of lenses) {
      const on = (b.dataset.dashLens ?? "") === lens;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    }
  };

  // Filter + cap every section, paint the expanders, pick the best match.
  const apply = (): void => {
    const query = input.value.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    let total = 0;
    let bestRank = 3;
    firstResult = null;

    for (const s of sections) {
      const inLens = lens === "home" || lens === s.key;
      s.matches.clear();
      if (inLens) {
        for (const t of s.tiles) {
          if (tokens.every((tok) => t.text.includes(tok))) s.matches.add(t);
        }
      }
      // A lens-focused section is the whole view; never cap it.
      const cap = s.expanded || lens === s.key ? Infinity : s.cap;
      let i = 0;
      for (const t of s.tiles) {
        const show = s.matches.has(t) && i < cap;
        t.el.hidden = !show;
        if (s.matches.has(t)) i++;
        if (show && tokens.length) {
          const rank = t.title.startsWith(query) ? 0 : t.title.includes(query) ? 1 : 2;
          if (rank < bestRank) { bestRank = rank; firstResult = t.el; }
        } else if (show && !firstResult) {
          firstResult = t.el;
        }
      }
      s.shown = Math.min(s.matches.size, cap);
      total += s.matches.size;
      s.root.hidden = s.matches.size === 0;
      if (s.more) {
        const overflow = s.matches.size - s.shown;
        const collapsible = s.expanded && s.matches.size > s.cap && lens !== s.key;
        s.more.hidden = overflow <= 0 && !collapsible;
        s.more.textContent = overflow > 0
          ? `See ${overflow} more result${overflow === 1 ? "" : "s"}`
          : "See fewer results";
        s.more.setAttribute("aria-expanded", String(s.expanded));
      }
    }

    if (emptyEl) emptyEl.hidden = total > 0;
    if (statusEl) statusEl.textContent = `${total} result${total === 1 ? "" : "s"}`;
  };

  const reset = (): void => {
    input.value = "";
    lens = "home";
    for (const s of sections) s.expanded = false;
    syncLenses();
    apply();
    results.scrollTop = 0;
  };

  // ---- open / close ------------------------------------------------------

  const syncBfb = (): void => {
    bfb?.classList.toggle("is-open", visible);
    bfb?.setAttribute("aria-expanded", String(visible));
  };

  const open = (): void => {
    if (visible) return;
    visible = true;
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root.hidden = false;
    // After un-hiding: scroll/focus writes are ignored while display:none.
    reset();
    // Force a reflow so removing `hidden` and adding `is-visible` animate.
    void root.offsetWidth;
    root.classList.add("is-visible");
    syncBfb();
    input.focus();
  };

  const close = (): void => {
    if (!visible) return;
    visible = false;
    syncBfb();
    // Idempotent and self-detaching, so transitionend and the safety timeout
    // can race to call it without leaking a listener (same shape as lock.ts).
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
    const target = opener?.isConnected ? opener : bfb;
    opener = null;
    target?.focus();
  };

  const toggle = (): void => {
    if (visible) close();
    else open();
  };

  // ---- activation --------------------------------------------------------

  const runAction = (action: string): void => {
    if (action === "studio") { openStudio(); return; }
    if (action === "trash") { openTrash(); return; }
    if (action.startsWith("music:")) {
      const i = Number(action.slice(6));
      // Switch first (synchronous selection, async load), then start the
      // transport inside the same user gesture; a playing player restarts on
      // the new song by itself.
      void audio.selectTrack(i);
      if (!audio.isPlaying()) void audio.toggle();
      openStudio();
      return;
    }
    // The rest reuse the top panel's action vocabulary (identical flows).
    void dispatchAction(`dlg:${action}`);
  };

  results.addEventListener("click", (e) => {
    const tile = (e.target as Element | null)?.closest<HTMLElement>("[data-dash-tile]");
    if (tile) {
      const action = tile.dataset.dashAction;
      // Close before dispatching so dialogs/windows take focus cleanly;
      // anchor tiles keep their native navigation.
      close();
      if (action) runAction(action);
      return;
    }
    const more = (e.target as Element | null)?.closest<HTMLElement>("[data-dash-more]");
    if (more) {
      const s = sections.find((x) => x.more === more);
      if (s) { s.expanded = !s.expanded; apply(); }
    }
  });

  for (const b of lenses) {
    b.addEventListener("click", () => {
      lens = b.dataset.dashLens ?? "home";
      for (const s of sections) s.expanded = false;
      syncLenses();
      apply();
    });
  }

  backdrop?.addEventListener("click", close);
  bfb?.addEventListener("click", toggle);

  // Click-away: launcher / panel clicks land outside the dash root entirely.
  document.addEventListener("click", (e) => {
    if (!visible) return;
    const target = e.target as Element | null;
    if (!target || panel.contains(target) || target.closest("[data-dash-open]")) return;
    close();
  });

  // ---- keyboard ----------------------------------------------------------

  const visibleTiles = (): HTMLElement[] =>
    sections.flatMap((s) => (s.root.hidden ? [] : s.tiles))
      .filter((t) => !t.el.hidden)
      .map((t) => t.el);

  const focusTile = (el: HTMLElement | null): void => {
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  };

  // Geometric vertical move: find the nearest row in the requested direction,
  // then the closest tile by horizontal center — works across sections and
  // any column count without knowing the grid template.
  const moveVertical = (cur: HTMLElement, dir: 1 | -1): void => {
    const tiles = visibleTiles();
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const candidates = tiles.filter((el) => {
      const t = el.getBoundingClientRect().top;
      return dir === 1 ? t > r.top + 4 : t < r.top - 4;
    });
    if (!candidates.length) {
      if (dir === -1) input.focus();
      return;
    }
    const tops = candidates.map((el) => el.getBoundingClientRect().top);
    const rowTop = dir === 1 ? Math.min(...tops) : Math.max(...tops);
    let best: HTMLElement | null = null;
    let bestDx = Infinity;
    for (const el of candidates) {
      const b = el.getBoundingClientRect();
      if (Math.abs(b.top - rowTop) > 4) continue;
      const dx = Math.abs(b.left + b.width / 2 - cx);
      if (dx < bestDx) { bestDx = dx; best = el; }
    }
    focusTile(best);
  };

  // Tab stays structural: the input, visible expanders, and the lens bar.
  const tabbables = (): HTMLElement[] => [
    input,
    ...sections.flatMap((s) => (s.more && !s.more.hidden && !s.root.hidden ? [s.more] : [])),
    ...lenses,
  ];

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (input.value) {
        input.value = "";
        for (const s of sections) s.expanded = false;
        apply();
        input.focus();
      } else {
        close();
      }
      return;
    }
    if (e.key === "Tab") {
      const items = tabbables();
      let idx = items.indexOf(document.activeElement as HTMLElement);
      if (idx === -1) idx = 0; // from a tile, re-enter the structural cycle
      e.preventDefault();
      items[(idx + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus();
      return;
    }

    const onTile = (document.activeElement as HTMLElement | null)?.dataset?.dashTile !== undefined;
    const cur = document.activeElement as HTMLElement | null;

    if (e.key === "Enter" && document.activeElement === input) {
      e.preventDefault();
      firstResult?.click();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (onTile && cur) moveVertical(cur, 1);
      else focusTile(visibleTiles()[0] ?? null);
      return;
    }
    if (e.key === "ArrowUp" && onTile && cur) {
      e.preventDefault();
      moveVertical(cur, -1);
      return;
    }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && onTile && cur) {
      e.preventDefault();
      const tiles = visibleTiles();
      const idx = tiles.indexOf(cur);
      focusTile(tiles[idx + (e.key === "ArrowRight" ? 1 : -1)] ?? null);
      return;
    }
    // Type-ahead: printable keys (and Backspace) land in the search field no
    // matter what holds focus, like Unity.
    if (document.activeElement !== input && !e.ctrlKey && !e.metaKey && !e.altKey
        && (e.key.length === 1 || e.key === "Backspace")) {
      input.focus();
    }
  });

  input.addEventListener("input", () => {
    // New query: collapse every section again so results re-rank from the top.
    for (const s of sections) s.expanded = false;
    apply();
  });

  // ---- Super tap ---------------------------------------------------------
  // A *plain* Meta tap (no other key while held) toggles the Dash, like
  // Unity's overlay key. Chords (Cmd+C, Super+L, ...) cancel the tap, so
  // browser/OS shortcuts are untouched. Best-effort by platform: macOS
  // delivers a clean tap, some window managers swallow Super before the
  // browser sees it — the BFB is the universal path.
  let superTap = false;

  const overlayBlocked = (): boolean => {
    const lock = document.querySelector<HTMLElement>("[data-up-lock]");
    if (lock && !lock.hidden) return true;
    const host = document.getElementById("up-dialog-host");
    return Boolean(host && host.childElementCount > 0);
  };

  window.addEventListener("keydown", (e) => {
    if (e.key === "Meta" && !e.repeat) { superTap = !overlayBlocked(); return; }
    superTap = false;
  }, true);
  window.addEventListener("keyup", (e) => {
    if (e.key !== "Meta" || !superTap) return;
    superTap = false;
    toggle();
  }, true);
  window.addEventListener("pointerdown", () => { superTap = false; }, true);
  window.addEventListener("blur", () => { superTap = false; });

  apply();
}
