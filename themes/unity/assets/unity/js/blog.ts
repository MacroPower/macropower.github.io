import { installFilterNav } from "./filter-nav";
import { locale, t } from "./i18n";

type SortKey = "name" | "date";
type SortDir = "asc" | "desc";

interface SortState {
  key: SortKey;
  dir: SortDir;
}

((): void => {
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

  // The name of the column the list sorts by, for screen readers. It
  // starts with the name the column shows.
  function sortedLabel({ key, dir }: SortState): string {
    if (key === "name") return dir === "desc" ? t("js_blog_name_sorted_desc") : t("js_blog_name_sorted_asc");
    return dir === "desc" ? t("js_blog_date_sorted_desc") : t("js_blog_date_sorted_asc");
  }

  function applySort(): void {
    if (!listBody) return;
    const rows = Array.from(
      listBody.querySelectorAll<HTMLElement>("[data-up-post-row]"),
    );
    const key = sortState.key;
    const dir = sortState.dir === "desc" ? -1 : 1;
    const attr = key === "name" ? "data-title" : "data-date";
    // Titles sort by the page's language, and ISO dates sort as strings.
    const collator = new Intl.Collator(locale(), { sensitivity: "base", numeric: true });
    rows.sort((a, b) => {
      const av = a.getAttribute(attr) ?? "";
      const bv = b.getAttribute(attr) ?? "";
      if (key === "name") return collator.compare(av, bv) * dir;
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
        btn.setAttribute("aria-pressed", "true");
        btn.setAttribute("aria-label", sortedLabel(sortState));
        if (caret) caret.textContent = sortState.dir === "desc" ? "▾" : "▴";
      } else {
        btn.setAttribute("aria-pressed", "false");
        btn.removeAttribute("aria-label");
        if (caret) caret.textContent = "";
      }
    });

    controller.applyFilters();
  }

  sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-up-sort");
      if (k !== "name" && k !== "date") return;
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
      return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : document.documentElement;
    };
    let ticking = false;
    const updateProgress = (): void => {
      const scroller = findScroller(reader);
      const max = scroller.scrollHeight - scroller.clientHeight;
      const pct = max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0;
      progressBar.style.transform = `scaleX(${pct.toFixed(4)})`;
      ticking = false;
    };
    const onScroll = (): void => {
      if (!ticking) { ticking = true; requestAnimationFrame(updateProgress); }
    };
    // Capture-phase so element scroll events from any container reach us:
    // the real scroller can change identity after init (the reader pane
    // only becomes scrollable once images load).
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
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
      btn.setAttribute("aria-label", t("js_blog_copy_code"));
      btn.textContent = t("js_blog_copy");
      btn.addEventListener("click", () => {
        const code = pre.querySelector("code") ?? pre;
        const text = code.innerText.replace(/ /g, " ");
        const done = (ok: boolean): void => {
          btn.textContent = ok ? t("js_blog_copied") : t("js_blog_copy_failed");
          btn.classList.toggle("is-copied", ok);
          setTimeout(() => {
            btn.textContent = t("js_blog_copy");
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
