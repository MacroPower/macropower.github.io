import { t } from "./i18n";
import { eventHTMLElement } from "./dom";
import { scrollBehavior } from "./prefs";
import { inlineDirection, inlineStep } from "./inline-keys";

export interface FilterNavOptions {
  root: HTMLElement;
  items: HTMLElement[];
  emptyEl: HTMLElement | null;
  searchToggle: HTMLElement | null;
  searchBar: HTMLElement | null;
  searchInput: HTMLInputElement | null;
  searchCount: HTMLElement | null;
  searchClose: HTMLElement | null;

  // Per-item search match. The shared module trims + lowercases the input
  // value before calling, so the caller compares against already-lowercase
  // data-* attributes directly.
  searchMatch: (item: HTMLElement, query: string) => boolean;

  // Per-item filter predicate (taxonomy, lang, etc.). Defaults to () => true.
  // The page mutates its own state and then calls controller.applyFilters().
  prefilter?: (item: HTMLElement) => boolean;

  // Fires on Enter from the focused item. Defaults to item.click().
  onActivate?: (item: HTMLElement) => void;

  // Which keys move the cursor. "vertical" (default) accepts ↑, ↓, j,
  // and k. "both" also accepts ←, →, h, and l for a grid. Left and Right
  // follow the grid's inline direction, so in a right-to-left grid Left
  // moves to the next item.
  axis?: "vertical" | "both";

  // Fires at the end of every applyFilters() pass. Used by callers that need
  // to reconcile selection state with the post-filter visibility set.
  onAfterFilter?: () => void;
}

export interface FilterNav {
  applyFilters: () => void;
}

// The vi keys stand for the arrow keys.
const VI_ARROWS: Readonly<Record<string, string>> = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" };

export function installFilterNav(opts: FilterNavOptions): FilterNav {
  const {
    root,
    items,
    emptyEl,
    searchToggle,
    searchBar,
    searchInput,
    searchCount,
    searchClose,
    searchMatch,
    prefilter = (): boolean => true,
    onActivate = (item): void => { item.click(); },
    axis = "vertical",
    onAfterFilter,
  } = opts;

  const NAV_KEYS = axis === "both"
    ? new Set([
        "ArrowDown", "ArrowRight", "j", "l",
        "ArrowUp", "ArrowLeft", "k", "h",
        "Home", "End", "Enter",
      ])
    : new Set([
        "ArrowDown", "j",
        "ArrowUp", "k",
        "Home", "End", "Enter",
      ]);

  let currentQuery = "";
  let searchOpen = false;

  function applyFilters(): void {
    let visible = 0;
    for (const item of items) {
      const hide = !(
        prefilter(item) && (!currentQuery || searchMatch(item, currentQuery))
      );
      if (item.hidden !== hide) item.hidden = hide;
      if (!hide) visible++;
    }
    const emptyHide = visible !== 0;
    if (emptyEl && emptyEl.hidden !== emptyHide) emptyEl.hidden = emptyHide;
    if (searchCount) {
      searchCount.textContent = currentQuery
        ? t("js_desktop_filter_count", { visible, count: items.length })
        : "";
    }
    onAfterFilter?.();
  }

  function setSearchOpen(open: boolean): void {
    if (!searchBar || !searchToggle) return;
    searchOpen = Boolean(open);
    searchBar.hidden = !searchOpen;
    searchToggle.setAttribute("aria-expanded", searchOpen ? "true" : "false");
    searchToggle.classList.toggle("is-active", searchOpen);
    if (searchOpen) {
      requestAnimationFrame(() => { searchInput?.focus(); });
    } else {
      if (searchInput) searchInput.value = "";
      currentQuery = "";
      applyFilters();
    }
  }

  searchToggle?.addEventListener("click", () => { setSearchOpen(!searchOpen); });
  searchClose?.addEventListener("click", () => { setSearchOpen(false); });
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      currentQuery = searchInput.value.trim().toLowerCase();
      applyFilters();
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); setSearchOpen(false); }
      if (e.key === "Enter") {
        e.preventDefault();
        const first = items.find((i) => !i.hidden);
        if (first) onActivate(first);
      }
    });
  }

  function focusItem(item: HTMLElement | null, moveFocus = false): void {
    for (const i of items) i.classList.remove("is-focused");
    if (!item) return;
    item.classList.add("is-focused");
    if (moveFocus) item.focus({ preventScroll: true });
    item.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }

  document.addEventListener("keydown", (e) => {
    if (!root.isConnected) return;
    if (e.defaultPrevented) return;
    const target = eventHTMLElement(e);
    const tag = target?.tagName ?? "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || Boolean(target?.isContentEditable);

    if ((e.key === "/" || (e.key === "f" && (e.ctrlKey || e.metaKey))) && !typing && searchToggle) {
      e.preventDefault();
      setSearchOpen(true);
      return;
    }
    if (typing) return;
    if (!NAV_KEYS.has(e.key)) return;

    const list = items.filter((i) => !i.hidden);
    if (!list.length) return;

    // Real DOM focus follows the cursor only when focus is already on (or in)
    // an item — i.e. the user tabbed into the grid/list. When focus sits
    // elsewhere (body, the sidebar filters, the search toggle), a document-
    // level arrow press must not yank it away, so only the visual cursor moves.
    const focusInItems =
      target instanceof HTMLElement &&
      items.some((i) => i === target || i.contains(target));

    // The really-focused item wins over the painted cursor, so Tab-ing into
    // the list rebinds Enter/arrows to where focus actually is; the class
    // fallbacks keep the cursor model for focus-outside navigation.
    let idx = focusInItems
      ? list.findIndex((i) => i === target || i.contains(target))
      : -1;
    if (idx === -1) idx = list.findIndex((i) => i.classList.contains("is-focused"));
    if (idx === -1) idx = list.findIndex((i) => i.classList.contains("is-active"));

    if (e.key === "Enter") {
      // A focused control outside the items owns its own Enter: hijacking it
      // would activate a tile instead and preventDefault the control's native
      // click.
      if (
        !focusInItems &&
        target instanceof HTMLElement &&
        target.closest("a, button, summary, [tabindex]")
      ) return;
      const focused = list[idx];
      if (focused) { e.preventDefault(); onActivate(focused); }
      return;
    }

    // The items run in reading order, so Down steps to the next item and
    // Left or Right steps the way the grid lays its rows out.
    const key = VI_ARROWS[e.key] ?? e.key;
    let nextIdx: number;
    switch (key) {
      case "ArrowDown":
        nextIdx = Math.min(list.length - 1, idx + 1);
        break;
      case "ArrowUp":
        nextIdx = Math.max(0, idx - 1);
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        const grid = list[0]?.parentElement ?? root;
        nextIdx = Math.min(list.length - 1, Math.max(0, idx + inlineStep(key, inlineDirection(grid))));
        break;
      }
      case "Home":
        nextIdx = 0;
        break;
      case "End":
        nextIdx = list.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    focusItem(list[nextIdx] ?? null, focusInItems);
  });

  applyFilters();
  return { applyFilters };
}
