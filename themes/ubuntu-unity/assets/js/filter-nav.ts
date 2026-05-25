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
}

export interface FilterNav {
  applyFilters: () => void;
}

const NAV_KEYS = new Set([
  "ArrowDown", "ArrowRight", "j", "l",
  "ArrowUp", "ArrowLeft", "k", "h",
  "Home", "End", "Enter",
]);

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
        ? `${visible} / ${items.length}`
        : "";
    }
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

  function focusItem(item: HTMLElement | null): void {
    for (const i of items) i.classList.remove("is-focused");
    if (!item) return;
    item.classList.add("is-focused");
    item.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  document.addEventListener("keydown", (e) => {
    if (!root.isConnected) return;
    if (e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
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
    const idx = list.findIndex((i) => i.matches(".is-active, .is-focused"));

    if (e.key === "Enter") {
      const focused = list[idx];
      if (focused) { e.preventDefault(); onActivate(focused); }
      return;
    }

    let nextIdx: number;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
      case "j":
      case "l":
        nextIdx = Math.min(list.length - 1, idx + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
      case "k":
      case "h":
        nextIdx = Math.max(0, idx - 1);
        break;
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
    focusItem(list[nextIdx] ?? null);
  });

  applyFilters();
  return { applyFilters };
}
