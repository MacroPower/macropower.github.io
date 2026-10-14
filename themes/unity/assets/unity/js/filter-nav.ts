import { t } from "./i18n";
import { eventElement, eventHTMLElement, overlayOpen } from "./dom";
import { scrollBehavior } from "./prefs";
import { inlineDirection, inlineStep } from "./inline-keys";
import { filterNavKey, type FilterNavAxis, type KeyModifiers } from "./filter-nav-keys";

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

  // Per-item filter predicate, such as one by taxonomy or language. Defaults
  // to () => true.
  // The page mutates its own state and then calls controller.applyFilters().
  prefilter?: (item: HTMLElement) => boolean;

  // Fires on Enter from the focused item. Defaults to item.click().
  onActivate?: (item: HTMLElement) => void;

  // Which keys move the cursor. "vertical" (default) accepts ↑, ↓, j,
  // and k. "both" also accepts ←, →, h, and l for a grid. Left and Right
  // follow the grid's inline direction, so in a right-to-left grid Left
  // moves to the next item.
  axis?: FilterNavAxis;

  // Fires at the end of every applyFilters() pass. A caller that must
  // reconcile its selection with the visibility after filtering listens here.
  onAfterFilter?: () => void;
}

export interface FilterNav {
  applyFilters: () => void;
}

function modifiers(e: KeyboardEvent): KeyModifiers {
  return { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey };
}

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
      if (filterNavKey(e.key, modifiers(e), axis)?.kind === "activate") {
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

  // Whether a key belongs to the list. The listener sits on the document,
  // so it also hears the keys that a dialog, the Dash, another window, or
  // the top panel takes. The list takes no key while its window stays
  // closed or minimized, or while an overlay covers the page. Otherwise it
  // takes a key from inside its root, or from the body while the page
  // window holds focus.
  function ownsKey(target: Element | null): boolean {
    const win = window.UP_PAGE_WINDOW_STATE;
    if (win?.visible === false) return false;
    if (overlayOpen()) return false;
    if (!target || target === document.body) return win?.focused !== false;
    return root.contains(target);
  }

  document.addEventListener("keydown", (e) => {
    if (!root.isConnected) return;
    if (e.defaultPrevented) return;
    const target = eventHTMLElement(e);
    if (!ownsKey(eventElement(e))) return;
    const tag = target?.tagName ?? "";
    const typing = tag === "INPUT" || tag === "TEXTAREA" || Boolean(target?.isContentEditable);

    if ((e.key === "/" || (e.key === "f" && (e.ctrlKey || e.metaKey))) && !typing && searchToggle) {
      e.preventDefault();
      setSearchOpen(true);
      return;
    }
    if (typing) return;
    const intent = filterNavKey(e.key, modifiers(e), axis);
    if (!intent) return;

    const list = items.filter((i) => !i.hidden);
    if (!list.length) return;

    // DOM focus follows the cursor only when focus already sits on an item
    // or inside one, because the visitor tabbed into the list. When focus
    // sits elsewhere, such as on the body, a sidebar filter, or the search
    // toggle, a key press moves only the painted cursor.
    const focusInItems =
      target instanceof HTMLElement &&
      items.some((i) => i === target || i.contains(target));

    // The focused item wins over the painted cursor, so after Tab moves
    // focus into the list, Enter and the arrows act on the focused item.
    // Without focus in the list, the cursor starts from the painted item.
    let idx = focusInItems
      ? list.findIndex((i) => i === target || i.contains(target))
      : -1;
    if (idx === -1) idx = list.findIndex((i) => i.classList.contains("is-focused"));
    if (idx === -1) idx = list.findIndex((i) => i.classList.contains("is-active"));

    if (intent.kind === "activate") {
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
    let nextIdx: number;
    if (intent.kind === "inline") {
      const grid = list[0]?.parentElement ?? root;
      nextIdx = idx + inlineStep(intent.key, inlineDirection(grid));
    } else {
      switch (intent.to) {
        case "next": nextIdx = idx + 1; break;
        case "prev": nextIdx = idx - 1; break;
        case "first": nextIdx = 0; break;
        case "last": nextIdx = list.length - 1; break;
      }
    }
    nextIdx = Math.min(list.length - 1, Math.max(0, nextIdx));
    e.preventDefault();
    focusItem(list[nextIdx] ?? null, focusInItems);
  });

  applyFilters();
  return { applyFilters };
}
