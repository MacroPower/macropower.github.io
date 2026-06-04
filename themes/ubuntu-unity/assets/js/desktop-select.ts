// Shared icon-grid selection model: a Set of selected tiles plus an anchor —
// the range origin for Shift-click and the "primary" tile of a multi-selection.
// projects.ts (preview pane) and trash.ts (footer count) each create one
// instance and drive it through projects-desktop's gestures. The generic class
// toggling (.is-active/.is-anchor/.is-focused) lives here; each consumer paints
// its own selection-dependent pane via onRender.
//
// Imported by both the app.ts and projects.ts bundles — esbuild duplicates the
// module into each, so the instances are independent. Keep all state inside
// createSelection; module-level mutable state would silently desync the copies.

export interface SelectionDeps {
  /** Tile elements in DOM order. Shared by reference with the gesture engine,
   *  which reorders and splices it in place. */
  tiles: HTMLElement[];
  /** Which tiles selection operations may target. Defaults to attached,
   *  visible tiles — filter-hiding (projects) and tile removal (trash) both
   *  fall out of the same predicate via syncAfterChange. */
  selectable?(tile: HTMLElement): boolean;
  /** Paint the consumer's selection-dependent UI (preview pane, footer). */
  onRender(): void;
}

export interface Selection {
  has(tile: HTMLElement): boolean;
  /** Insertion-ordered snapshot of the selected tiles. */
  get(): HTMLElement[];
  anchor(): HTMLElement | null;
  setSingle(tile: HTMLElement): void;
  toggle(tile: HTMLElement): void;
  selectRange(tile: HTMLElement): void;
  setMany(tiles: HTMLElement[], additive: boolean): void;
  clear(): void;
  selectAllVisible(): void;
  /** Drop members that are no longer selectable (hidden by a filter pass,
   *  detached by a removal), fix the anchor, and re-render. */
  syncAfterChange(): void;
}

export function createSelection(deps: SelectionDeps): Selection {
  const selectable =
    deps.selectable ?? ((t: HTMLElement): boolean => !t.hidden && t.isConnected);

  const selection = new Set<HTMLElement>();
  let anchor: HTMLElement | null = null;

  const selectableTiles = (): HTMLElement[] => deps.tiles.filter(selectable);

  // Last insertion-order member of a Set (the fallback anchor when the current
  // one is removed). Avoids spreading the whole Set just to index its tail.
  const lastOf = (set: Set<HTMLElement>): HTMLElement | null => {
    let v: HTMLElement | null = null;
    for (const t of set) v = t;
    return v;
  };
  const sameSet = (a: Set<HTMLElement>, b: Set<HTMLElement>): boolean => {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  };

  function render(): void {
    const multi = selection.size > 1;
    for (const t of deps.tiles) {
      t.classList.toggle("is-active", selection.has(t));
      // The anchor ring only distinguishes the primary tile among several
      // selected tiles; a lone selection keeps the plain active look.
      t.classList.toggle("is-anchor", multi && t === anchor);
      // Selection drives keyboard focus: clearing .is-focused lets filter-nav's
      // arrow nav resume from the selected (.is-active) tile, while filter-nav
      // re-adds the focus ring itself when navigating onto an unselected tile.
      t.classList.remove("is-focused");
    }
    deps.onRender();
  }

  function setSingle(tile: HTMLElement): void {
    selection.clear();
    selection.add(tile);
    anchor = tile;
    render();
  }
  function toggle(tile: HTMLElement): void {
    if (selection.has(tile)) {
      selection.delete(tile);
      if (anchor === tile) anchor = lastOf(selection);
    } else {
      selection.add(tile);
      anchor = tile;
    }
    render();
  }
  function selectRange(tile: HTMLElement): void {
    if (!anchor) { setSingle(tile); return; }
    const vis = selectableTiles();
    const a = vis.indexOf(anchor);
    const b = vis.indexOf(tile);
    if (a === -1 || b === -1) { setSingle(tile); return; }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    selection.clear();
    for (let i = lo; i <= hi; i++) selection.add(vis[i]!);
    render();
  }
  function setMany(many: HTMLElement[], additive: boolean): void {
    const next = new Set<HTMLElement>(additive ? selection : undefined);
    for (const t of many) next.add(t);
    // Marquee calls this on every pointermove; bail before the consumer's
    // render when the resulting set is unchanged (pointer dithering, skimming
    // a gap).
    if (sameSet(next, selection)) return;
    selection.clear();
    for (const t of next) selection.add(t);
    if (many.length) anchor = many[many.length - 1]!;
    else if (anchor && !selection.has(anchor)) anchor = lastOf(selection);
    render();
  }
  function clear(): void {
    selection.clear();
    anchor = null;
    render();
  }
  function selectAllVisible(): void {
    const vis = selectableTiles();
    selection.clear();
    for (const t of vis) selection.add(t);
    anchor = vis[0] ?? null;
    render();
  }
  function syncAfterChange(): void {
    for (const t of [...selection]) if (!selectable(t)) selection.delete(t);
    if (anchor && !selectable(anchor)) anchor = lastOf(selection);
    render();
  }

  return {
    has: (tile) => selection.has(tile),
    get: () => [...selection],
    anchor: () => anchor,
    setSingle,
    toggle,
    selectRange,
    setMany,
    clear,
    selectAllVisible,
    syncAfterChange,
  };
}
