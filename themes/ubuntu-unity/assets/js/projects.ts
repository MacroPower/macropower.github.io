import { installFilterNav } from "./filter-nav";
import { installDesktop } from "./projects-desktop";

(function (): void {
  "use strict";

  const root = document.querySelector<HTMLElement>("[data-projects-kind]");
  if (!root) return;

  const grid = root.querySelector<HTMLElement>("[data-up-project-grid]");
  const tiles = grid
    ? Array.from(grid.querySelectorAll<HTMLElement>("[data-up-project-tile]"))
    : [];
  const emptyEl = root.querySelector<HTMLElement>("[data-up-project-empty]");
  const preview = root.querySelector<HTMLElement>("[data-up-project-preview]");
  const filterBtns = Array.from(
    root.querySelectorAll<HTMLElement>("[data-projects-filter]"),
  );

  // Hugo emits the Recent cutoff on the root so build-time and runtime see
  // the same ISO date (see data-projects-recent-cutoff in projects/list.html).
  const recentCutoffISO = root.dataset.projectsRecentCutoff ?? "";

  const initialPreviewHTML = preview?.innerHTML ?? "";
  const initialPreviewClass = preview?.className ?? "";
  function resetPreview(): void {
    if (!preview) return;
    preview.className = initialPreviewClass;
    preview.innerHTML = initialPreviewHTML;
  }

  // Explicit selection model driven by projects-desktop. `anchor` is both the
  // range origin for Shift-click and the preview source when one tile is shown.
  const selection = new Set<HTMLElement>();
  let anchor: HTMLElement | null = null;

  const visibleTiles = (): HTMLElement[] => tiles.filter((t) => !t.hidden);

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

  function renderSelection(): void {
    const multi = selection.size > 1;
    for (const t of tiles) {
      t.classList.toggle("is-active", selection.has(t));
      // The anchor ring only distinguishes the preview source among several
      // selected tiles; a lone selection keeps the plain active look.
      t.classList.toggle("is-anchor", multi && t === anchor);
      // Selection drives keyboard focus: clearing .is-focused lets filter-nav's
      // arrow nav resume from the selected (.is-active) tile, while filter-nav
      // re-adds the focus ring itself when navigating onto an unselected tile.
      t.classList.remove("is-focused");
    }

    const n = selection.size;
    if (n === 0) { resetPreview(); return; }
    if (n === 1) {
      buildPreview(anchor && selection.has(anchor) ? anchor : selection.values().next().value!);
      return;
    }
    buildMultiPreview(n);
  }

  function setSingle(tile: HTMLElement): void {
    selection.clear();
    selection.add(tile);
    anchor = tile;
    renderSelection();
  }
  function toggle(tile: HTMLElement): void {
    if (selection.has(tile)) {
      selection.delete(tile);
      if (anchor === tile) anchor = lastOf(selection);
    } else {
      selection.add(tile);
      anchor = tile;
    }
    renderSelection();
  }
  function selectRange(tile: HTMLElement): void {
    if (!anchor) { setSingle(tile); return; }
    const vis = visibleTiles();
    const a = vis.indexOf(anchor);
    const b = vis.indexOf(tile);
    if (a === -1 || b === -1) { setSingle(tile); return; }
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    selection.clear();
    for (let i = lo; i <= hi; i++) selection.add(vis[i]!);
    renderSelection();
  }
  function setMany(many: HTMLElement[], additive: boolean): void {
    const next = new Set<HTMLElement>(additive ? selection : undefined);
    for (const t of many) next.add(t);
    // Marquee calls this on every pointermove; bail before the preview rebuild
    // when the resulting set is unchanged (pointer dithering, skimming a gap).
    if (sameSet(next, selection)) return;
    selection.clear();
    for (const t of next) selection.add(t);
    if (many.length) anchor = many[many.length - 1]!;
    else if (anchor && !selection.has(anchor)) anchor = lastOf(selection);
    renderSelection();
  }
  function clear(): void {
    selection.clear();
    anchor = null;
    renderSelection();
  }
  function selectAllVisible(): void {
    const vis = visibleTiles();
    selection.clear();
    for (const t of vis) selection.add(t);
    anchor = vis[0] ?? null;
    renderSelection();
  }

  function syncSelectionAfterFilter(): void {
    for (const t of [...selection]) if (t.hidden) selection.delete(t);
    if (anchor && anchor.hidden) anchor = lastOf(selection);
    renderSelection();
  }

  let currentFilter = "all";

  const PREDICATES: Record<string, (t: HTMLElement) => boolean> = {
    all: () => true,
    starred: (t) => Number(t.dataset.stars ?? "0") >= 100,
    recent: (t) => (t.dataset.updated ?? "") > recentCutoffISO,
    forks: (t) => Number(t.dataset.forks ?? "0") > 5,
  };

  function filterMatches(tile: HTMLElement): boolean {
    if (currentFilter.startsWith("lang:")) {
      return (tile.dataset.language ?? "") === currentFilter.slice(5);
    }
    return (PREDICATES[currentFilter] ?? PREDICATES.all!)(tile);
  }

  function searchMatch(tile: HTMLElement, query: string): boolean {
    const name = (tile.dataset.name ?? "").toLowerCase();
    const topics = (tile.dataset.topics ?? "").toLowerCase();
    return name.includes(query) || topics.includes(query);
  }

  const folderTpl = document.querySelector<HTMLTemplateElement>("#up-project-folder-tpl");

  const iconsTpl = document.querySelector<HTMLTemplateElement>("#up-project-icons");
  const ICONS = new Map<string, string>();
  if (iconsTpl) {
    for (const el of iconsTpl.content.querySelectorAll<HTMLElement>("[data-icon]")) {
      const key = el.dataset.icon;
      if (key) ICONS.set(key, el.innerHTML);
    }
  }
  const iconHTML = (key: string): string => ICONS.get(key) ?? "";

  function fmtNum(n: string): string {
    const num = Number(n);
    if (!Number.isFinite(num)) return n;
    if (num >= 1000) return `${(num / 1000).toFixed(num >= 10_000 ? 0 : 1)}k`;
    return String(num);
  }

  function buildStat(
    iconKey: string,
    ariaLabel: string,
    value: string,
    wide = false,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = "up-project-preview-stat" + (wide ? " up-project-preview-stat-wide" : "");
    el.setAttribute("aria-label", `${ariaLabel}: ${value}`);
    el.innerHTML = iconHTML(iconKey);
    const valEl = document.createElement("span");
    valEl.textContent = value;
    el.appendChild(valEl);
    return el;
  }

  function buildFolderHeader(lang: string): HTMLElement | null {
    if (!folderTpl) return null;
    const clone = folderTpl.content.firstElementChild?.cloneNode(true) as HTMLElement | null;
    if (!clone) return null;
    const useEl = clone.querySelector<SVGUseElement>("[data-emblem-use]");
    if (useEl) useEl.setAttribute("href", `#lang-${lang}`);
    return clone;
  }

  function buildPreview(tile: HTMLElement): void {
    if (!preview) return;
    const d = tile.dataset;
    const name = d.name ?? "";
    const desc = d.description ?? "";
    const lang = d.language ?? "";
    const stars = d.stars ?? "";
    const forks = d.forks ?? "";
    const license = d.license ?? "";
    const updated = d.updated ?? "";
    const topics = (d.topics ?? "").split(/\s+/).filter(Boolean);
    const url = d.url ?? "";

    preview.classList.remove("up-empty-pane");
    preview.replaceChildren();

    const header = document.createElement("div");
    header.className = "up-project-preview-header";
    const folder = buildFolderHeader(lang);
    if (folder) header.appendChild(folder);
    const headText = document.createElement("div");
    headText.className = "up-project-preview-header-text";
    const title = document.createElement("h2");
    title.className = "up-project-preview-title";
    title.textContent = name;
    headText.appendChild(title);
    if (lang) {
      const pill = document.createElement("span");
      pill.className = "up-project-preview-lang";
      const SVG_NS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "12");
      svg.setAttribute("height", "12");
      const use = document.createElementNS(SVG_NS, "use");
      use.setAttribute("href", `#lang-${lang}`);
      svg.appendChild(use);
      pill.appendChild(svg);
      pill.appendChild(document.createTextNode(lang));
      headText.appendChild(pill);
    }
    header.appendChild(headText);
    preview.appendChild(header);

    const body = document.createElement("div");
    body.className = "up-project-preview-body";

    if (desc) {
      const p = document.createElement("p");
      p.className = "up-project-preview-desc";
      p.textContent = desc;
      body.appendChild(p);
    }

    const stats = document.createElement("div");
    stats.className = "up-project-preview-stats";
    if (stars) stats.appendChild(buildStat("star", "Stars", fmtNum(stars)));
    if (forks) stats.appendChild(buildStat("fork", "Forks", fmtNum(forks)));
    if (license) stats.appendChild(buildStat("license", "License", license, true));
    if (updated) stats.appendChild(buildStat("clock", "Updated", updated, true));
    if (stats.childElementCount) body.appendChild(stats);

    if (topics.length) {
      const label = document.createElement("div");
      label.className = "up-project-preview-section-label";
      label.textContent = "Topics";
      body.appendChild(label);
      const wrap = document.createElement("div");
      wrap.className = "up-project-preview-topics";
      for (const t of topics) {
        const chip = document.createElement("span");
        chip.className = "up-project-chip";
        chip.textContent = `#${t}`;
        wrap.appendChild(chip);
      }
      body.appendChild(wrap);
    }

    if (url) {
      const a = document.createElement("a");
      a.className = "up-open-btn";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = `${iconHTML("github")}<span>Open on GitHub</span>`;
      body.appendChild(a);
    }

    preview.appendChild(body);
  }

  // Multi-select summary: reuses the preview header/body scaffolding with a
  // plain folder (no language emblem) and lists selected names as chips.
  function buildMultiPreview(n: number): void {
    if (!preview) return;
    preview.classList.remove("up-empty-pane");
    preview.replaceChildren();

    const header = document.createElement("div");
    header.className = "up-project-preview-header";
    const folder = buildFolderHeader("");
    if (folder) header.appendChild(folder);
    const headText = document.createElement("div");
    headText.className = "up-project-preview-header-text";
    const title = document.createElement("h2");
    title.className = "up-project-preview-title";
    title.textContent = `${n} projects selected`;
    headText.appendChild(title);
    header.appendChild(headText);
    preview.appendChild(header);

    const body = document.createElement("div");
    body.className = "up-project-preview-body";
    const label = document.createElement("div");
    label.className = "up-project-preview-section-label";
    label.textContent = "Selection";
    body.appendChild(label);
    const list = document.createElement("div");
    list.className = "up-project-preview-namelist";
    for (const t of selection) {
      const chip = document.createElement("span");
      chip.className = "up-project-chip";
      chip.textContent = t.dataset.name ?? "";
      list.appendChild(chip);
    }
    body.appendChild(list);
    preview.appendChild(body);
  }

  const controller = installFilterNav({
    root,
    items: tiles,
    emptyEl,
    searchToggle: root.querySelector<HTMLElement>("[data-up-search-toggle]"),
    searchBar: root.querySelector<HTMLElement>("[data-up-search-bar]"),
    searchInput: root.querySelector<HTMLInputElement>("[data-up-search-input]"),
    searchCount: root.querySelector<HTMLElement>("[data-up-search-count]"),
    searchClose: root.querySelector<HTMLElement>("[data-up-search-close]"),
    searchMatch,
    prefilter: filterMatches,
    axis: "both",
    onAfterFilter: syncSelectionAfterFilter,
  });

  for (const btn of filterBtns) {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-projects-filter");
      if (!key) return;
      currentFilter = key;
      for (const other of filterBtns) other.classList.remove("is-active");
      btn.classList.add("is-active");
      controller.applyFilters();
    });
  }

  if (grid) {
    installDesktop({
      grid,
      tiles,
      get: () => [...selection],
      anchor: () => anchor,
      setSingle,
      toggle,
      selectRange,
      setMany,
      clear,
      selectAllVisible,
    });
  }
})();
