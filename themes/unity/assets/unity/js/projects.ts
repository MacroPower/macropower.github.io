import { createSelection } from "./desktop-select";
import { installFilterNav } from "./filter-nav";
import { isolate, locale, t, tn } from "./i18n";
import { forgeName, installDesktop, openLabel } from "./projects-desktop";

((): void => {
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

  const initialPreviewHTML = preview?.innerHTML ?? "";
  const initialPreviewClass = preview?.className ?? "";
  function resetPreview(): void {
    if (!preview) return;
    preview.className = initialPreviewClass;
    preview.innerHTML = initialPreviewHTML;
  }

  // Selection model that projects-desktop drives. The anchor is both the range
  // origin for Shift-click and the preview source when the pane shows one
  // tile. The Set and anchor mechanics live in desktop-select, which trash.ts
  // shares, and this page adds the preview-pane painting through onRender.
  const selection = createSelection({ tiles, onRender: renderPreviewPane });

  function renderPreviewPane(): void {
    const sel = selection.get();
    const n = sel.length;
    if (n === 0) { resetPreview(); return; }
    if (n === 1) {
      const a = selection.anchor();
      buildPreview(a && selection.has(a) ? a : sel[0]!);
      return;
    }
    buildMultiPreview(n);
  }

  let currentFilter = "all";

  // Hugo writes each tile's filters (starred, recent, forks) into
  // data-filters, so the thresholds live only in the theme's params and the
  // sidebar counts always agree with the grid.
  function filterMatches(tile: HTMLElement): boolean {
    if (currentFilter === "all") return true;
    if (currentFilter.startsWith("lang:")) {
      return (tile.dataset.language ?? "") === currentFilter.slice(5);
    }
    return (tile.dataset.filters ?? "").split(" ").includes(currentFilter);
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

  const compact = new Intl.NumberFormat(locale(), { notation: "compact", maximumFractionDigits: 1 });
  function fmtNum(n: string): string {
    const num = Number(n);
    return Number.isFinite(num) ? compact.format(num) : n;
  }

  /** A stat's icon and value. label(value) names the stat for screen
   *  readers. */
  function buildStat(
    iconKey: string,
    value: string,
    label: (value: string) => string,
    wide = false,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = `up-project-preview-stat${wide ? " up-project-preview-stat-wide" : ""}`;
    el.setAttribute("aria-label", label(value));
    el.innerHTML = iconHTML(iconKey);
    const valEl = document.createElement("span");
    valEl.textContent = value;
    el.appendChild(valEl);
    return el;
  }

  // Tiles carry data-lang-symbol, resolved server-side against the sprite,
  // so a language without artwork already points at the generic emblem.
  function buildFolderHeader(symbol: string): HTMLElement | null {
    if (!folderTpl) return null;
    const clone = folderTpl.content.firstElementChild?.cloneNode(true);
    if (!(clone instanceof HTMLElement)) return null;
    const useEl = clone.querySelector<SVGUseElement>("[data-emblem-use]");
    if (useEl) useEl.setAttribute("href", `#${symbol}`);
    return clone;
  }

  function buildPreview(tile: HTMLElement): void {
    if (!preview) return;
    const d = tile.dataset;
    const name = d.name ?? "";
    const desc = d.description ?? "";
    const lang = d.language ?? "";
    const langSymbol = d.langSymbol ?? "lang-generic";
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
    const folder = buildFolderHeader(langSymbol);
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
      use.setAttribute("href", `#${langSymbol}`);
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
    if (stars) stats.appendChild(buildStat("star", fmtNum(stars), (value) => t("js_projects_stars", { value })));
    if (forks) stats.appendChild(buildStat("fork", fmtNum(forks), (value) => t("js_projects_forks", { value })));
    if (license) stats.appendChild(buildStat("license", license, (value) => t("js_projects_license", { value: isolate(value) }), true));
    if (updated) stats.appendChild(buildStat("clock", updated, (value) => t("js_projects_updated", { value }), true));
    if (stats.childElementCount) body.appendChild(stats);

    if (topics.length) {
      const label = document.createElement("div");
      label.className = "up-project-preview-section-label";
      label.textContent = t("js_projects_topics");
      body.appendChild(label);
      const wrap = document.createElement("div");
      wrap.className = "up-project-preview-topics";
      for (const topic of topics) {
        const chip = document.createElement("span");
        chip.className = "up-project-chip";
        chip.textContent = `#${topic}`;
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
      const label = document.createElement("span");
      label.textContent = openLabel(url);
      a.innerHTML = iconHTML(forgeName(url) === "GitHub" ? "github" : "link");
      a.appendChild(label);
      body.appendChild(a);
    }

    preview.appendChild(body);
  }

  // Multi-select summary. It reuses the preview header and body scaffolding
  // with a plain folder (no language emblem) and lists the selected names as
  // chips.
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
    title.textContent = tn("js_projects_selected", n);
    headText.appendChild(title);
    header.appendChild(headText);
    preview.appendChild(header);

    const body = document.createElement("div");
    body.className = "up-project-preview-body";
    const label = document.createElement("div");
    label.className = "up-project-preview-section-label";
    label.textContent = t("js_projects_selection");
    body.appendChild(label);
    const list = document.createElement("div");
    list.className = "up-project-preview-namelist";
    for (const item of selection.get()) {
      const chip = document.createElement("span");
      chip.className = "up-project-chip";
      chip.textContent = item.dataset.name ?? "";
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
    onAfterFilter: () => selection.syncAfterChange(),
  });

  for (const btn of filterBtns) {
    // Mirror the SSR is-active state (the All filter) for AT, then keep
    // aria-pressed in lockstep with the class on every filter change.
    btn.setAttribute("aria-pressed", btn.classList.contains("is-active") ? "true" : "false");
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-projects-filter");
      if (!key) return;
      currentFilter = key;
      for (const other of filterBtns) {
        other.classList.remove("is-active");
        other.setAttribute("aria-pressed", "false");
      }
      btn.classList.add("is-active");
      btn.setAttribute("aria-pressed", "true");
      controller.applyFilters();
    });
  }

  if (grid) {
    installDesktop({
      grid,
      tiles,
      get: selection.get,
      anchor: selection.anchor,
      setSingle: selection.setSingle,
      toggle: selection.toggle,
      selectRange: selection.selectRange,
      setMany: selection.setMany,
      clear: selection.clear,
      selectAllVisible: selection.selectAllVisible,
    });
  }
})();
