type SortKey = "name" | "date";
type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

(function (): void {
  "use strict";

  const root = document.querySelector<HTMLElement>("[data-blog-kind]");
  if (!root) return;

  const listBody = root.querySelector<HTMLElement>("[data-up-post-list-body]");
  const allRows = listBody
    ? Array.from(listBody.querySelectorAll<HTMLElement>("[data-up-post-row]"))
    : [];
  const emptyEl = root.querySelector<HTMLElement>("[data-up-post-empty]");
  const searchToggle = root.querySelector<HTMLElement>("[data-up-search-toggle]");
  const searchBar = root.querySelector<HTMLElement>("[data-up-search-bar]");
  const searchInput = root.querySelector<HTMLInputElement>("[data-up-search-input]");
  const searchCount = root.querySelector<HTMLElement>("[data-up-search-count]");
  const searchClose = root.querySelector<HTMLElement>("[data-up-search-close]");
  const sortBtns = root.querySelectorAll<HTMLElement>("[data-up-sort]");

  /* ----- Sortable columns -------------------------------------------------- */
  const sortState: SortState = { key: "date", dir: "desc" };

  function applySort(): void {
    if (!listBody) return;
    const rows = Array.from(
      listBody.querySelectorAll<HTMLElement>("[data-up-post-row]"),
    );
    const key = sortState.key;
    const dir = sortState.dir === "desc" ? -1 : 1;
    const attr = key === "name" ? "data-title" : "data-date";
    rows.sort((a, b) => {
      const av = a.getAttribute(attr) ?? "";
      const bv = b.getAttribute(attr) ?? "";
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    const frag = document.createDocumentFragment();
    rows.forEach((r) => { frag.appendChild(r); });
    if (emptyEl) frag.appendChild(emptyEl);
    listBody.appendChild(frag);

    sortBtns.forEach((btn) => {
      const k = btn.getAttribute("data-up-sort");
      const caret = btn.querySelector<HTMLElement>(".up-post-list-caret");
      btn.classList.remove("is-sorted", "is-asc", "is-desc");
      if (k === key) {
        btn.classList.add("is-sorted", sortState.dir === "desc" ? "is-desc" : "is-asc");
        btn.setAttribute("aria-sort", sortState.dir === "desc" ? "descending" : "ascending");
        if (caret) caret.textContent = sortState.dir === "desc" ? "▾" : "▴";
      } else {
        btn.setAttribute("aria-sort", "none");
        if (caret) caret.textContent = "";
      }
    });
  }

  sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-up-sort") as SortKey | null;
      if (!k) return;
      if (sortState.key === k) {
        sortState.dir = sortState.dir === "desc" ? "asc" : "desc";
      } else {
        sortState.key = k;
        sortState.dir = k === "date" ? "desc" : "asc";
      }
      applySort();
    });
  });

  /* ----- Filter / search --------------------------------------------------- */
  let searchOpen = false;

  function applyFilter(q: string): void {
    const query = q.trim().toLowerCase();
    let visible = 0;
    allRows.forEach((row) => {
      if (!query) { row.hidden = false; visible++; return; }
      const title = row.getAttribute("data-title") ?? "";
      const tags = row.getAttribute("data-tags") ?? "";
      const match = title.includes(query) || tags.includes(query);
      row.hidden = !match;
      if (match) visible++;
    });
    if (emptyEl) emptyEl.hidden = visible !== 0;
    if (searchCount) {
      searchCount.textContent = query ? `${visible} / ${allRows.length}` : "";
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
      if (searchInput) { searchInput.value = ""; }
      applyFilter("");
    }
  }

  searchToggle?.addEventListener("click", () => { setSearchOpen(!searchOpen); });
  searchClose?.addEventListener("click", () => { setSearchOpen(false); });
  if (searchInput) {
    searchInput.addEventListener("input", () => { applyFilter(searchInput.value); });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); setSearchOpen(false); }
      if (e.key === "Enter") {
        e.preventDefault();
        const firstVisible = allRows.find((r) => !r.hidden);
        firstVisible?.click();
      }
    });
  }

  /* ----- Keyboard nav for list --------------------------------------------- */
  function visibleRows(): HTMLElement[] {
    return allRows.filter((r) => !r.hidden);
  }

  function focusedIndex(rows: HTMLElement[]): number {
    const active = listBody?.querySelector<HTMLElement>(
      ".up-post-row.is-active, .up-post-row.is-focused",
    );
    if (!active) return -1;
    return rows.indexOf(active);
  }

  function focusRow(row: HTMLElement | null): void {
    allRows.forEach((r) => { r.classList.remove("is-focused"); });
    if (!row) return;
    row.classList.add("is-focused");
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  document.addEventListener("keydown", (e) => {
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

    const rows = visibleRows();
    if (!rows.length) return;
    const idx = focusedIndex(rows);
    let next: HTMLElement | null = null;

    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      next = rows[Math.min(rows.length - 1, idx + 1)] ?? rows[0] ?? null;
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      next = rows[Math.max(0, idx - 1)] ?? rows[0] ?? null;
    } else if (e.key === "Home") {
      e.preventDefault();
      next = rows[0] ?? null;
    } else if (e.key === "End") {
      e.preventDefault();
      next = rows[rows.length - 1] ?? null;
    } else if (e.key === "Enter") {
      const focused = rows[idx];
      if (focused) { e.preventDefault(); focused.click(); }
      return;
    } else {
      return;
    }
    focusRow(next);
  });

  /* ----- Reading progress bar (single-post only) --------------------------- */
  const reader = root.querySelector<HTMLElement>("[data-up-reader]");
  const progressBar = root.querySelector<HTMLElement>("[data-up-reader-progress-bar]");
  if (reader && progressBar) {
    const findScroller = (el: HTMLElement): HTMLElement => {
      let node: HTMLElement | null = el;
      while (node && node !== document.body) {
        if (node.scrollHeight > node.clientHeight + 1) {
          const ov = getComputedStyle(node).overflowY;
          if (ov === "auto" || ov === "scroll") return node;
        }
        node = node.parentElement;
      }
      return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
    };
    let scroller = findScroller(reader);
    let ticking = false;
    const updateProgress = (): void => {
      scroller = findScroller(reader);
      const max = scroller.scrollHeight - scroller.clientHeight;
      const pct = max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0;
      progressBar.style.transform = `scaleX(${pct.toFixed(4)})`;
      ticking = false;
    };
    const onScroll = (): void => {
      if (!ticking) { ticking = true; requestAnimationFrame(updateProgress); }
    };
    const bindScroll = (): void => {
      scroller = findScroller(reader);
      (scroller === document.scrollingElement ? window : scroller)
        .addEventListener("scroll", onScroll, { passive: true });
    };
    bindScroll();
    window.addEventListener("resize", updateProgress);
    updateProgress();
  }

  /* ----- Code block copy buttons ------------------------------------------- */
  const readerBody = root.querySelector<HTMLElement>("[data-up-reader-body]");
  if (readerBody) {
    const pres = readerBody.querySelectorAll<HTMLPreElement>("pre");
    pres.forEach((pre) => {
      if (pre.closest(".up-codeblock")) return;
      const wrap = document.createElement("div");
      wrap.className = "up-codeblock";
      pre.parentNode?.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "up-code-copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.textContent = "Copy";
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code") ?? pre;
        const text = (code as HTMLElement).innerText.replace(/ /g, " ");
        const done = (ok: boolean): void => {
          btn.textContent = ok ? "Copied" : "Failed";
          btn.classList.toggle("is-copied", ok);
          setTimeout(() => {
            btn.textContent = "Copy";
            btn.classList.remove("is-copied");
          }, 1400);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).then(() => { done(true); }, () => { done(false); });
        } else {
          try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            done(document.execCommand("copy"));
            document.body.removeChild(ta);
          } catch {
            done(false);
          }
        }
      });
      wrap.appendChild(btn);
    });
  }
})();
