import { installFilterNav } from "./filter-nav";

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
  const sortBtns = root.querySelectorAll<HTMLElement>("[data-up-sort]");

  const controller = installFilterNav({
    root,
    items: allRows,
    emptyEl,
    searchToggle: root.querySelector<HTMLElement>("[data-up-search-toggle]"),
    searchBar: root.querySelector<HTMLElement>("[data-up-search-bar]"),
    searchInput: root.querySelector<HTMLInputElement>("[data-up-search-input]"),
    searchCount: root.querySelector<HTMLElement>("[data-up-search-count]"),
    searchClose: root.querySelector<HTMLElement>("[data-up-search-close]"),
    searchMatch: (row, query) => {
      const title = row.getAttribute("data-title") ?? "";
      const tags = row.getAttribute("data-tags") ?? "";
      return title.includes(query) || tags.includes(query);
    },
  });

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

    controller.applyFilters();
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
