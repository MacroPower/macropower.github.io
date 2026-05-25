import { installFilterNav } from "./filter-nav";

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

  function syncActiveTile(): void {
    const active = tiles.find((t) => t.classList.contains("is-active"));
    if (active && active.hidden) {
      active.classList.remove("is-active");
      resetPreview();
    }
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
      a.className = "up-project-preview-open";
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.innerHTML = `${iconHTML("github")}<span>Open on GitHub</span>`;
      body.appendChild(a);
    }

    preview.appendChild(body);
  }

  function selectTile(tile: HTMLElement): void {
    for (const t of tiles) t.classList.remove("is-active");
    tile.classList.add("is-active");
    buildPreview(tile);
  }

  for (const tile of tiles) {
    tile.addEventListener("click", () => { selectTile(tile); });
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
    onAfterFilter: syncActiveTile,
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
})();
