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

  // Cutoff for "Recent" must match the Hugo sidebar predicate exactly so the
  // count and the visible tiles can't drift. Hugo uses `now.AddDate 0 -6 0`
  // (calendar-month subtraction) with strict `gt`; mirror both here by
  // subtracting six calendar months and comparing the ISO date strings with `>`.
  const recentCutoffISO = ((): string => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    return d.toISOString().slice(0, 10);
  })();

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

  const ICONS = {
    star: '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true"><path d="M7 1.4 L8.6 5 L12.4 5.4 L9.5 8 L10.4 12 L7 9.9 L3.6 12 L4.5 8 L1.6 5.4 L5.4 5 Z" fill="#E5A526" stroke="#A06F0E" stroke-width=".5" stroke-linejoin="round"/></svg>',
    fork: '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3 V6 Q4 7.4 5.4 8 L7 8.6 L8.6 8 Q10 7.4 10 6 V3"/><path d="M7 8.6 V12"/><circle cx="4" cy="2.8" r="1.2" fill="currentColor"/><circle cx="10" cy="2.8" r="1.2" fill="currentColor"/><circle cx="7" cy="12" r="1.2" fill="currentColor"/></svg>',
    license: '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><rect x="3" y="1.6" width="8" height="10.8" rx=".5"/><line x1="4.6" y1="4.4" x2="9.4" y2="4.4"/><line x1="4.6" y1="6.4" x2="9.4" y2="6.4"/><line x1="4.6" y1="8.4" x2="8" y2="8.4"/></svg>',
    clock: '<svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><circle cx="7" cy="7" r="5.4"/><path d="M7 4 V7 L9 8.4"/></svg>',
    github: '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M7 1.3 C3.9 1.3 1.4 3.8 1.4 6.9 C1.4 9.4 3 11.5 5.3 12.2 C5.6 12.3 5.7 12.1 5.7 11.9 V11 C4.1 11.3 3.8 10.4 3.8 10.4 C3.6 9.8 3.2 9.7 3.2 9.7 C2.7 9.4 3.3 9.4 3.3 9.4 C3.8 9.5 4.1 10 4.1 10 C4.6 10.8 5.4 10.6 5.7 10.4 C5.8 10.1 5.9 9.8 6.1 9.7 C4.9 9.6 3.6 9.1 3.6 6.8 C3.6 6.1 3.8 5.6 4.1 5.2 C4.1 5 3.9 4.4 4.2 3.6 C4.2 3.6 4.7 3.5 5.7 4.2 C6.1 4.1 6.6 4 7 4 C7.4 4 7.9 4.1 8.3 4.2 C9.3 3.5 9.8 3.6 9.8 3.6 C10.1 4.4 9.9 5 9.9 5.2 C10.2 5.6 10.4 6.1 10.4 6.8 C10.4 9.1 9.1 9.6 7.9 9.7 C8.1 9.9 8.3 10.2 8.3 10.7 V11.9 C8.3 12.1 8.4 12.3 8.7 12.2 C11 11.5 12.6 9.4 12.6 6.9 C12.6 3.8 10.1 1.3 7 1.3 Z" fill="currentColor"/></svg>',
  } as const;

  function fmtNum(n: string): string {
    const num = Number(n);
    if (!Number.isFinite(num)) return n;
    if (num >= 1000) return `${(num / 1000).toFixed(num >= 10_000 ? 0 : 1)}k`;
    return String(num);
  }

  function buildStat(
    iconKey: keyof typeof ICONS,
    ariaLabel: string,
    value: string,
    wide = false,
  ): HTMLElement {
    const el = document.createElement("div");
    el.className = "up-project-preview-stat" + (wide ? " up-project-preview-stat-wide" : "");
    el.setAttribute("aria-label", `${ariaLabel}: ${value}`);
    el.innerHTML = ICONS[iconKey] + `<span>${value}</span>`;
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

    preview.classList.remove("up-empty-pane", "up-project-preview-empty");
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
      pill.innerHTML =
        `<svg viewBox="0 0 24 24" width="12" height="12"><use href="#lang-${lang}"/></svg>${lang}`;
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
      a.innerHTML = `${ICONS.github}<span>Open on GitHub</span>`;
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
