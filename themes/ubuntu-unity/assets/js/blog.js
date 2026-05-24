(function () {
  "use strict";

  var root = document.querySelector("[data-blog-kind]");
  if (!root) return;

  var listEl = root.querySelector("[data-up-post-list]");
  var listBody = root.querySelector("[data-up-post-list-body]");
  var allRows = listBody ? Array.prototype.slice.call(listBody.querySelectorAll("[data-up-post-row]")) : [];
  var emptyEl = root.querySelector("[data-up-post-empty]");
  var searchToggle = root.querySelector("[data-up-search-toggle]");
  var searchBar = root.querySelector("[data-up-search-bar]");
  var searchInput = root.querySelector("[data-up-search-input]");
  var searchCount = root.querySelector("[data-up-search-count]");
  var searchClose = root.querySelector("[data-up-search-close]");
  var sortBtns = root.querySelectorAll("[data-up-sort]");

  /* ----- Sortable columns -------------------------------------------------- */
  var sortState = { key: "date", dir: "desc" };

  function applySort() {
    if (!listBody) return;
    var rows = Array.prototype.slice.call(listBody.querySelectorAll("[data-up-post-row]"));
    var key = sortState.key;
    var dir = sortState.dir === "desc" ? -1 : 1;
    rows.sort(function (a, b) {
      var av = a.getAttribute("data-" + (key === "name" ? "title" : "date")) || "";
      var bv = b.getAttribute("data-" + (key === "name" ? "title" : "date")) || "";
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    var frag = document.createDocumentFragment();
    rows.forEach(function (r) { frag.appendChild(r); });
    if (emptyEl) frag.appendChild(emptyEl);
    listBody.appendChild(frag);

    sortBtns.forEach(function (btn) {
      var k = btn.getAttribute("data-up-sort");
      var caret = btn.querySelector(".up-post-list-caret");
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

  sortBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var k = btn.getAttribute("data-up-sort");
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
  var searchOpen = false;

  function setSearchOpen(open) {
    if (!searchBar || !searchToggle) return;
    searchOpen = !!open;
    searchBar.hidden = !searchOpen;
    searchToggle.setAttribute("aria-expanded", searchOpen ? "true" : "false");
    searchToggle.classList.toggle("is-active", searchOpen);
    if (searchOpen) {
      requestAnimationFrame(function () { searchInput && searchInput.focus(); });
    } else {
      if (searchInput) { searchInput.value = ""; }
      applyFilter("");
    }
  }

  function applyFilter(q) {
    var query = (q || "").trim().toLowerCase();
    var visible = 0;
    allRows.forEach(function (row) {
      if (!query) { row.hidden = false; visible++; return; }
      var title = row.getAttribute("data-title") || "";
      var tags = row.getAttribute("data-tags") || "";
      var match = title.indexOf(query) !== -1 || tags.indexOf(query) !== -1;
      row.hidden = !match;
      if (match) visible++;
    });
    if (emptyEl) emptyEl.hidden = visible !== 0;
    if (searchCount) {
      searchCount.textContent = query ? visible + " / " + allRows.length : "";
    }
  }

  if (searchToggle) searchToggle.addEventListener("click", function () { setSearchOpen(!searchOpen); });
  if (searchClose) searchClose.addEventListener("click", function () { setSearchOpen(false); });
  if (searchInput) {
    searchInput.addEventListener("input", function () { applyFilter(searchInput.value); });
    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { e.preventDefault(); setSearchOpen(false); }
      if (e.key === "Enter") {
        e.preventDefault();
        var firstVisible = allRows.filter(function (r) { return !r.hidden; })[0];
        if (firstVisible) firstVisible.click();
      }
    });
  }

  /* ----- Keyboard nav for list --------------------------------------------- */
  function visibleRows() {
    return allRows.filter(function (r) { return !r.hidden; });
  }

  function focusedIndex(rows) {
    var active = listBody && listBody.querySelector(".up-post-row.is-active, .up-post-row.is-focused");
    if (!active) return -1;
    return rows.indexOf(active);
  }

  function focusRow(row) {
    allRows.forEach(function (r) { r.classList.remove("is-focused"); });
    if (!row) return;
    row.classList.add("is-focused");
    if (row.scrollIntoView) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    var tag = (e.target && e.target.tagName) || "";
    var typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable);

    if ((e.key === "/" || (e.key === "f" && (e.ctrlKey || e.metaKey))) && !typing && searchToggle) {
      e.preventDefault();
      setSearchOpen(true);
      return;
    }
    if (typing) return;

    var rows = visibleRows();
    if (!rows.length) return;
    var idx = focusedIndex(rows);
    var next = null;

    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      next = rows[Math.min(rows.length - 1, idx + 1)] || rows[0];
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      next = rows[Math.max(0, idx - 1)] || rows[0];
    } else if (e.key === "Home") {
      e.preventDefault();
      next = rows[0];
    } else if (e.key === "End") {
      e.preventDefault();
      next = rows[rows.length - 1];
    } else if (e.key === "Enter") {
      var focused = rows[idx];
      if (focused) { e.preventDefault(); focused.click(); }
      return;
    } else {
      return;
    }
    focusRow(next);
  });

  /* ----- Reading progress bar (single-post only) --------------------------- */
  var reader = root.querySelector("[data-up-reader]");
  var progressBar = root.querySelector("[data-up-reader-progress-bar]");
  if (reader && progressBar) {
    var findScroller = function (el) {
      var node = el;
      while (node && node !== document.body) {
        if (node.scrollHeight > node.clientHeight + 1) {
          var ov = getComputedStyle(node).overflowY;
          if (ov === "auto" || ov === "scroll") return node;
        }
        node = node.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };
    var scroller = findScroller(reader);
    var ticking = false;
    var updateProgress = function () {
      scroller = findScroller(reader);
      var max = scroller.scrollHeight - scroller.clientHeight;
      var pct = max > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / max)) : 0;
      progressBar.style.transform = "scaleX(" + pct.toFixed(4) + ")";
      ticking = false;
    };
    var onScroll = function () {
      if (!ticking) { ticking = true; requestAnimationFrame(updateProgress); }
    };
    var bindScroll = function () {
      scroller = findScroller(reader);
      (scroller === document.scrollingElement ? window : scroller)
        .addEventListener("scroll", onScroll, { passive: true });
    };
    bindScroll();
    window.addEventListener("resize", updateProgress);
    updateProgress();
  }

  /* ----- Code block copy buttons ------------------------------------------- */
  var readerBody = root.querySelector("[data-up-reader-body]");
  if (readerBody) {
    var pres = readerBody.querySelectorAll("pre");
    pres.forEach(function (pre) {
      if (pre.closest(".up-codeblock")) return;
      var wrap = document.createElement("div");
      wrap.className = "up-codeblock";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "up-code-copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        var code = pre.querySelector("code") || pre;
        var text = code.innerText.replace(/ /g, " ");
        var done = function (ok) {
          btn.textContent = ok ? "Copied" : "Failed";
          btn.classList.toggle("is-copied", !!ok);
          setTimeout(function () {
            btn.textContent = "Copy";
            btn.classList.remove("is-copied");
          }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
        } else {
          try {
            var ta = document.createElement("textarea");
            ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
            document.body.appendChild(ta); ta.select();
            done(document.execCommand("copy"));
            document.body.removeChild(ta);
          } catch (_) { done(false); }
        }
      });
      wrap.appendChild(btn);
    });
  }
})();
