// Desktop file-manager gestures for the /projects/ grid: click-select,
// drag-to-reorder, double-click-to-open, multi-select, marquee, and a
// right-click menu. projects.ts owns the selection model and preview; this
// module is the sole gesture owner over the grid and drives that model through
// `deps`.
//
// Pointer Events throughout (capture + unified mouse/touch). The drag model is
// live reorder: the selected tiles lift and follow the cursor as one rigid block
// (every member moves by the same delta, keeping their relative positions) while
// the unselected tiles reorder in the CSS grid and slide to their new cells via
// FLIP. DOM order is the display order, so reordering mutates `deps.tiles` in
// place (the array filter-nav and projects.ts share) alongside the DOM. "Clean
// Up Icons" restores the original order. No persistence.

export interface DesktopDeps {
  grid: HTMLElement;
  tiles: HTMLElement[];
  get(): HTMLElement[];
  anchor(): HTMLElement | null;
  setSingle(tile: HTMLElement): void;
  toggle(tile: HTMLElement): void;
  selectRange(tile: HTMLElement): void;
  setMany(tiles: HTMLElement[], additive: boolean): void;
  clear(): void;
  selectAllVisible(): void;
}

const DRAG_THRESHOLD = 4;
const DBLCLICK_MS = 300;
const REFLOW_MS = 180;
const SETTLE_MS = 160;
const TILE_SEL = "[data-up-project-tile]";

export function installDesktop(deps: DesktopDeps): void {
  const { grid } = deps;
  // Reorders insert before this node so the empty-state placeholder stays last.
  const emptyAnchor = grid.querySelector<HTMLElement>("[data-up-project-empty]");
  const originalOrder = [...deps.tiles];

  // ---- gesture state -------------------------------------------------------
  let mode: "none" | "tile" | "marquee" = "none";
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let justDragged = false;

  let pressTile: HTMLElement | null = null;
  let pressShift = false;
  let pressCtrl = false;

  let lastClick: { tile: HTMLElement; time: number } | null = null;

  // ---- drag-reorder state --------------------------------------------------
  // The selection moves as one rigid block: every member rides the cursor by the
  // same delta, preserving the members' relative positions, while the unselected
  // tiles reorder underneath. startPos is each member's drag-start cell; layoutPos
  // is its current cell (its DOM slot shifts as the block is reinserted), refreshed
  // after each reorder. The follow transform bridges the two.
  let block: HTMLElement[] = [];
  const startPos = new Map<HTMLElement, { left: number; top: number }>();
  const layoutPos = new Map<HTMLElement, { left: number; top: number }>();
  let lastPointerX = 0;
  let lastPointerY = 0;
  let currentRef: HTMLElement | null = null; // tile the block currently sits before
  let orderAtDragStart: HTMLElement[] = [];
  // Resting cell rects of the insertion candidates (visible non-block tiles),
  // refreshed after each reorder so computeRef hit-tests without forced layout.
  const dragRects = new Map<HTMLElement, DOMRect>();

  let marquee: HTMLDivElement | null = null;
  let marqueeBase: HTMLElement[] = [];
  let marqueeRects: Array<{ el: HTMLElement; left: number; top: number; right: number; bottom: number }> = [];
  let marqueeGridLeft = 0;
  let marqueeGridTop = 0;

  function addMoveListeners(): void {
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endGesture);
    window.addEventListener("pointercancel", endGesture);
  }
  function removeMoveListeners(): void {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", endGesture);
    window.removeEventListener("pointercancel", endGesture);
  }

  grid.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // A drag that produced no synthetic click would otherwise carry a stale
    // justDragged into this gesture's click; reset it up front.
    justDragged = false;

    const target = e.target as HTMLElement;
    const tile = target.closest<HTMLElement>(TILE_SEL);

    if (tile && grid.contains(tile)) {
      // Don't change selection or preventDefault yet: that preserves the plain
      // click path and lets the manual double-click detector run on pointerup.
      mode = "tile";
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      moved = false;
      pressTile = tile;
      pressShift = e.shiftKey;
      pressCtrl = e.ctrlKey || e.metaKey;
      try { grid.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
      addMoveListeners();
      return;
    }

    // Empty branch: ignore the scrollbar gutter (offset past the content box).
    if (e.offsetX > grid.clientWidth || e.offsetY > grid.clientHeight) return;
    mode = "marquee";
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    pressCtrl = e.ctrlKey || e.metaKey;
    marqueeBase = deps.get();
    e.preventDefault(); // suppress label/text selection while marqueeing
    try { grid.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    addMoveListeners();
  });

  function onMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (mode === "tile") {
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      if (!moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        moved = true;
        startDrag();
      }
      applyFollow();
      const ref = computeRef();
      if (ref !== currentRef) reorderTo(ref);
      return;
    }

    if (mode === "marquee") {
      if (!moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        moved = true;
        snapshotMarquee();
        ensureMarquee().hidden = false;
      }
      updateMarquee(e);
    }
  }

  function endGesture(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const cancelled = e.type === "pointercancel";
    const wasMode = mode;
    const didMove = moved;

    try { grid.releasePointerCapture(pointerId); } catch { /* not captured */ }
    removeMoveListeners();
    mode = "none";
    pointerId = -1;

    if (wasMode === "tile") {
      if (didMove) {
        if (cancelled) cancelDrag();
        else dropDrag();
      } else if (!cancelled && pressTile) {
        if (pressShift) deps.selectRange(pressTile);
        else if (pressCtrl) deps.toggle(pressTile);
        else deps.setSingle(pressTile);

        // Manual double-click detection rather than native dblclick: the tile
        // branch captures the pointer and routes selection through pointerup,
        // and native dblclick while the pointer is captured is unreliable across
        // browsers.
        const now = performance.now();
        if (lastClick && lastClick.tile === pressTile && now - lastClick.time < DBLCLICK_MS) {
          const url = pressTile.dataset.url;
          if (url) window.open(url, "_blank", "noopener");
          lastClick = null;
        } else {
          lastClick = { tile: pressTile, time: now };
        }
      }
    } else if (wasMode === "marquee") {
      hideMarquee();
      // A marquee that never crossed threshold is a click-away on empty space.
      if (!didMove && !cancelled && !pressCtrl) deps.clear();
    }

    pressTile = null;
  }

  // ---- drag reorder --------------------------------------------------------
  function startDrag(): void {
    const sel = deps.get();
    if (pressTile && sel.includes(pressTile) && sel.length > 1) {
      // Pressed inside a multi-selection: move the whole group as one block.
      const selSet = new Set(sel);
      block = deps.tiles.filter((t) => selSet.has(t) && !t.hidden);
    } else {
      deps.setSingle(pressTile!);
      block = [pressTile!];
    }
    orderAtDragStart = [...deps.tiles];

    // Lift every block member, clearing any transform left over from a prior
    // settle so the start cell measures true.
    startPos.clear();
    layoutPos.clear();
    for (const el of block) { el.style.transition = "none"; el.style.transform = "none"; }
    void grid.offsetWidth;
    for (const el of block) {
      const r = el.getBoundingClientRect();
      startPos.set(el, { left: r.left, top: r.top });
      layoutPos.set(el, { left: r.left, top: r.top });
      el.style.zIndex = "10";
      el.classList.add("is-dragging");
    }
    grid.classList.add("is-dragging");

    snapshotInsertionRects();
    currentRef = computeRef();
    applyFollow();
  }

  // Place every block member at its start cell plus the pointer delta, so the
  // group moves rigidly under the cursor regardless of where its DOM slot moved.
  function applyFollow(): void {
    const dx = lastPointerX - startX;
    const dy = lastPointerY - startY;
    for (const el of block) {
      const s = startPos.get(el)!;
      const l = layoutPos.get(el)!;
      el.style.transform = `translate3d(${s.left + dx - l.left}px, ${s.top + dy - l.top}px, 0)`;
    }
  }

  function snapshotInsertionRects(): void {
    const blockSet = new Set(block);
    dragRects.clear();
    for (const t of deps.tiles) {
      if (!t.hidden && !blockSet.has(t)) dragRects.set(t, t.getBoundingClientRect());
    }
  }

  // Insertion target: the visible non-block tile the block should sit before, by
  // reading-order comparison of each candidate's cell center against the pointer
  // (a tile in an earlier row, or the same row and left of the pointer, counts as
  // before). The count of "before" tiles is the insertion index; null appends.
  function computeRef(): HTMLElement | null {
    const blockSet = new Set(block);
    const vis = deps.tiles.filter((t) => !t.hidden && !blockSet.has(t));
    if (!vis.length) return null;
    let idx = 0;
    for (const t of vis) {
      const r = dragRects.get(t);
      if (!r) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const band = r.height / 2;
      let before: boolean;
      if (cy < lastPointerY - band) before = true;
      else if (cy > lastPointerY + band) before = false;
      else before = cx < lastPointerX;
      if (before) idx++;
    }
    return vis[idx] ?? null;
  }

  function blockInsertOrder(ref: HTMLElement | null): HTMLElement[] {
    const blockSet = new Set(block);
    const rest = deps.tiles.filter((t) => !blockSet.has(t));
    let at = ref ? rest.indexOf(ref) : rest.length;
    if (at < 0) at = rest.length;
    return [...rest.slice(0, at), ...block, ...rest.slice(at)];
  }

  // Sync the shared tiles array and the DOM to a new order in one move.
  function commitOrder(order: HTMLElement[]): void {
    deps.tiles.length = 0;
    deps.tiles.push(...order);
    const frag = document.createDocumentFragment();
    for (const t of order) frag.appendChild(t);
    grid.insertBefore(frag, emptyAnchor);
  }

  function reorderTo(ref: HTMLElement | null): void {
    const blockSet = new Set(block);
    const movers = deps.tiles.filter((t) => !t.hidden && !blockSet.has(t));
    const first = new Map(movers.map((t) => [t, t.getBoundingClientRect()] as const));

    commitOrder(blockInsertOrder(ref));

    // Settle movers and the block to their new cells (transition off) and measure
    // clean: movers feed the FLIP and the insertion-rect cache; block members feed
    // their refreshed layout slot so the rigid follow stays anchored.
    for (const t of movers) { t.style.transition = "none"; t.style.transform = "none"; }
    for (const el of block) { el.style.transition = "none"; el.style.transform = "none"; }
    void grid.offsetWidth;
    dragRects.clear();
    const last = new Map<HTMLElement, DOMRect>();
    for (const t of movers) {
      const r = t.getBoundingClientRect();
      last.set(t, r);
      dragRects.set(t, r);
    }
    for (const el of block) {
      const r = el.getBoundingClientRect();
      layoutPos.set(el, { left: r.left, top: r.top });
    }
    applyFollow();

    // FLIP: jump each mover back to where it was, then release to its cell.
    for (const t of movers) {
      const f = first.get(t)!;
      const l = last.get(t)!;
      const dx = f.left - l.left;
      const dy = f.top - l.top;
      if (dx || dy) t.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    requestAnimationFrame(() => {
      for (const t of movers) {
        t.style.transition = `transform ${REFLOW_MS}ms ease`;
        t.style.transform = "none";
      }
    });

    currentRef = ref;
  }

  // FLIP a lifted tile from under the cursor down into its resting cell.
  function settle(el: HTMLElement): void {
    const f = el.getBoundingClientRect();
    el.style.transition = "none";
    el.style.transform = "none";
    const l = el.getBoundingClientRect();
    const dx = f.left - l.left;
    const dy = f.top - l.top;
    if (!dx && !dy) return;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${SETTLE_MS}ms ease`;
      el.style.transform = "none";
    });
  }

  function clearDragArtifacts(): void {
    for (const t of deps.tiles) {
      t.style.transition = "";
      t.style.transform = "";
      t.style.zIndex = "";
      t.classList.remove("is-dragging");
    }
    grid.classList.remove("is-dragging");
  }

  function resetDragVars(): void {
    block = [];
    currentRef = null;
    dragRects.clear();
    startPos.clear();
    layoutPos.clear();
  }

  function dropDrag(): void {
    grid.classList.remove("is-dragging");
    justDragged = true; // swallow the synthetic click that follows the drag
    for (const el of block) settle(el);
    window.setTimeout(clearDragArtifacts, Math.max(REFLOW_MS, SETTLE_MS) + 40);
    resetDragVars();
  }

  function cancelDrag(): void {
    clearDragArtifacts();
    resetDragVars();
  }

  // Restore a full order with a reflow animation. Used by "Clean Up Icons" and
  // Escape-during-drag (revert to the pre-drag order).
  function animateToOrder(order: HTMLElement[]): void {
    const movers = deps.tiles.filter((t) => !t.hidden);
    const first = new Map(movers.map((t) => [t, t.getBoundingClientRect()] as const));
    commitOrder(order);
    for (const t of movers) { t.style.transition = "none"; t.style.transform = "none"; }
    void grid.offsetWidth;
    for (const t of movers) {
      const f = first.get(t)!;
      const l = t.getBoundingClientRect();
      const dx = f.left - l.left;
      const dy = f.top - l.top;
      if (dx || dy) t.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    requestAnimationFrame(() => {
      for (const t of movers) {
        t.style.transition = `transform ${REFLOW_MS}ms ease`;
        t.style.transform = "none";
      }
    });
    window.setTimeout(() => {
      for (const t of movers) { t.style.transition = ""; t.style.transform = ""; }
    }, REFLOW_MS + 60);
  }

  function cleanUpIcons(): void {
    animateToOrder([...originalOrder]);
  }

  // Tiles are <button>s, so a click follows pointerup. Swallow it after a drag;
  // otherwise only act on keyboard activation (detail === 0): filter-nav's
  // onActivate -> item.click() and a native Space/Enter on a focused button.
  // Mouse single-clicks (detail >= 1) already selected on pointerup.
  grid.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const tile = target.closest<HTMLElement>(TILE_SEL);
    if (!tile) return;
    if (justDragged) {
      justDragged = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.detail === 0) deps.setSingle(tile);
  });

  // ---- marquee -------------------------------------------------------------
  function ensureMarquee(): HTMLDivElement {
    if (!marquee) {
      marquee = document.createElement("div");
      marquee.className = "up-marquee";
      marquee.hidden = true;
      grid.appendChild(marquee);
    }
    return marquee;
  }
  function hideMarquee(): void {
    if (marquee) marquee.hidden = true;
  }

  function snapshotMarquee(): void {
    const gr = grid.getBoundingClientRect();
    marqueeGridLeft = gr.left;
    marqueeGridTop = gr.top;
    const sx = grid.scrollLeft;
    const sy = grid.scrollTop;
    marqueeRects = [];
    for (const t of deps.tiles) {
      if (t.hidden) continue;
      const tb = t.getBoundingClientRect();
      const left = tb.left - gr.left + sx;
      const top = tb.top - gr.top + sy;
      marqueeRects.push({ el: t, left, top, right: left + tb.width, bottom: top + tb.height });
    }
  }

  function updateMarquee(e: PointerEvent): void {
    // Grid-content coordinates so the marquee tracks under scroll. The grid box
    // is fixed for the gesture; only the live scroll offset is read per move.
    const sx = grid.scrollLeft;
    const sy = grid.scrollTop;
    const toX = (clientX: number): number => clientX - marqueeGridLeft + sx;
    const toY = (clientY: number): number => clientY - marqueeGridTop + sy;

    const x0 = toX(startX);
    const y0 = toY(startY);
    const x1 = Math.max(0, Math.min(toX(e.clientX), grid.scrollWidth));
    const y1 = Math.max(0, Math.min(toY(e.clientY), grid.scrollHeight));

    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const right = Math.max(x0, x1);
    const bottom = Math.max(y0, y1);

    const m = ensureMarquee();
    m.style.left = `${left}px`;
    m.style.top = `${top}px`;
    m.style.width = `${right - left}px`;
    m.style.height = `${bottom - top}px`;

    const matched: HTMLElement[] = [];
    for (const r of marqueeRects) {
      if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
        matched.push(r.el);
      }
    }

    // Ctrl/Cmd adds to the selection present when the marquee began, so the
    // live set is the union of base and matched; recomputed each move rather
    // than accumulated, so shrinking the marquee releases tiles again.
    const next = pressCtrl ? union(marqueeBase, matched) : matched;
    deps.setMany(next, false);
  }

  // ---- context menu --------------------------------------------------------
  let ctxMenu: HTMLDivElement | null = null;

  function ensureCtxMenu(): HTMLDivElement {
    if (!ctxMenu) {
      ctxMenu = document.createElement("div");
      ctxMenu.className = "up-ctx-menu";
      ctxMenu.hidden = true;
      document.body.appendChild(ctxMenu);
    }
    return ctxMenu;
  }
  function closeCtxMenu(): void {
    if (ctxMenu) ctxMenu.hidden = true;
  }
  function ctxMenuOpen(): boolean {
    return ctxMenu?.hidden === false;
  }
  function ctxItem(label: string, fn: () => void): HTMLElement {
    const el = document.createElement("div");
    el.className = "up-ctx-item";
    el.textContent = label;
    el.addEventListener("click", () => { fn(); closeCtxMenu(); });
    return el;
  }

  grid.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const tile = target.closest<HTMLElement>(TILE_SEL);
    const menu = ensureCtxMenu();
    menu.replaceChildren();

    if (tile && grid.contains(tile)) {
      if (!deps.get().includes(tile)) deps.setSingle(tile);
      const url = tile.dataset.url ?? "";
      menu.appendChild(ctxItem("Open on GitHub", () => {
        if (url) window.open(url, "_blank", "noopener");
      }));
      menu.appendChild(ctxItem("Copy link", () => {
        if (url && navigator.clipboard) navigator.clipboard.writeText(url).catch(() => { /* no-op */ });
      }));
    } else {
      menu.appendChild(ctxItem("Select All", () => deps.selectAllVisible()));
      menu.appendChild(ctxItem("Clean Up Icons", () => cleanUpIcons()));
    }

    // Reveal first to measure, then clamp into the viewport.
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    let left = e.clientX;
    let top = e.clientY;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 4;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 4;
    menu.style.left = `${Math.max(4, left)}px`;
    menu.style.top = `${Math.max(4, top)}px`;
  });

  document.addEventListener("pointerdown", (e) => {
    if (!ctxMenuOpen()) return;
    if (!(e.target instanceof Node) || !ctxMenu!.contains(e.target)) closeCtxMenu();
  }, true);
  window.addEventListener("scroll", closeCtxMenu, true);
  window.addEventListener("resize", closeCtxMenu);

  // ---- Escape: consume only when the menu is open, a marquee is live, or a
  // drag is in progress, so filter-nav's search-Escape keeps working when these
  // features are idle.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (ctxMenuOpen()) {
      e.stopPropagation();
      closeCtxMenu();
      return;
    }
    if (mode === "tile" && moved && block.length) {
      e.stopPropagation();
      const revertTo = orderAtDragStart;
      for (const el of block) { el.classList.remove("is-dragging"); el.style.zIndex = ""; }
      grid.classList.remove("is-dragging");
      removeMoveListeners();
      try { grid.releasePointerCapture(pointerId); } catch { /* not captured */ }
      mode = "none";
      pointerId = -1;
      moved = false;
      animateToOrder(revertTo);
      resetDragVars();
      return;
    }
    if (mode === "marquee") {
      e.stopPropagation();
      hideMarquee();
      removeMoveListeners();
      try { grid.releasePointerCapture(pointerId); } catch { /* not captured */ }
      deps.setMany(marqueeBase, false);
      mode = "none";
      pointerId = -1;
      moved = false;
    }
  }, true);
}

function union(a: HTMLElement[], b: HTMLElement[]): HTMLElement[] {
  const set = new Set(a);
  for (const x of b) set.add(x);
  return [...set];
}
