import { setTrashFocused, subscribe, getTrashFocused } from "./focus";
import { installTitlebarDrag } from "./drag";

function syncLauncherTile(open: boolean, focused: boolean): void {
  const tile = document.querySelector<HTMLElement>("[data-launcher-trash]");
  if (!tile) return;
  tile.classList.toggle("is-active", open);
  tile.classList.toggle("is-focused", open && focused);
}

export function initTrash(): void {
  const stage = document.querySelector<HTMLElement>('[data-up-window="trash"]');
  if (!stage) return;
  const chrome = stage.querySelector<HTMLElement>(".up-window-chrome");
  if (!chrome) return;

  const closeBtn = chrome.querySelector<HTMLElement>(".up-tl-close");
  const minBtn   = chrome.querySelector<HTMLElement>(".up-tl-min");
  const emptyBtn = chrome.querySelector<HTMLButtonElement>("[data-trash-empty]");
  const filesView = chrome.querySelector<HTMLElement>("[data-trash-files]");
  const emptyView = chrome.querySelector<HTMLElement>(".up-trash-empty");
  const countEl = chrome.querySelector<HTMLElement>("[data-trash-count]");
  const tiles = Array.from(chrome.querySelectorAll<HTMLElement>(".up-trash-tile"));

  let open = false;
  let minimized = false;
  // Session-only: the trash refills on reload.
  let emptied = false;

  // Driven by the in-app toggle (the body class the CSS animation-kill keys
  // off), not the OS query: when set, the tile-out animation is suppressed, so
  // the animationend swap would never fire.
  const reduceMotion = (): boolean =>
    document.body.classList.contains("up-reduce-motion");

  // Swap between the file list and the empty state, and reflect the count /
  // button on the footer.
  const renderTrash = (): void => {
    if (filesView) filesView.hidden = emptied;
    if (emptyView) emptyView.hidden = !emptied;
    if (countEl) countEl.textContent = emptied ? "0 items" : `${tiles.length} items`;
    if (emptyBtn) {
      emptyBtn.disabled = emptied;
      emptyBtn.textContent = emptied ? "Trash is empty" : "Empty Trash";
    }
  };

  const finishEmpty = (): void => {
    emptied = true;
    if (filesView) filesView.classList.remove("is-removing");
    renderTrash();
  };

  const doEmpty = (): void => {
    if (!filesView || reduceMotion()) { finishEmpty(); return; }
    // Animate the tiles out, then swap to the empty state once the last tile's
    // animation lands. A timeout backstops a missed animationend event.
    let done = false;
    const onEnd = (): void => {
      if (done) return;
      done = true;
      filesView.removeEventListener("animationend", onEnd);
      finishEmpty();
    };
    filesView.addEventListener("animationend", onEnd);
    filesView.classList.add("is-removing");
    setTimeout(onEnd, 500);
  };

  const render = (): void => {
    const focused = getTrashFocused();
    const visible = open && !minimized;
    stage.hidden = !visible;
    chrome.classList.toggle("is-focused", visible && focused);
    syncLauncherTile(visible, focused);
  };

  const show = (): void => {
    open = true;
    minimized = false;
    setTrashFocused(true);
    render();
  };
  const hide = (): void => {
    open = false;
    minimized = false;
    setTrashFocused(false);
    render();
  };
  const minimize = (): void => {
    minimized = true;
    setTrashFocused(false);
    render();
  };

  closeBtn?.addEventListener("click", (e) => { e.stopPropagation(); hide(); });
  minBtn  ?.addEventListener("click", (e) => { e.stopPropagation(); minimize(); });

  emptyBtn?.addEventListener("click", () => {
    if (emptied) return;
    void (async () => {
      const r = await window.uiDialog?.({
        icon: "warning",
        title: `Permanently delete ${tiles.length} items?`,
        body: "If you empty the trash, the items will be permanently deleted. This can't be undone.",
        buttons: [
          { id: "cancel", label: "Cancel" },
          { id: "empty", label: "Empty Trash", primary: true, danger: true },
        ],
      });
      if (r === "empty") doEmpty();
    })();
  });

  document.addEventListener("click", (e) => {
    const target = e.target as Element | null;
    const t = target?.closest('[data-launcher="trash"]');
    if (!t) return;
    e.preventDefault();
    const focused = getTrashFocused();
    if (!open || minimized) { show(); return; }
    if (focused) { minimize(); return; }
    setTrashFocused(true);
    render();
  });

  chrome.addEventListener("mousedown", () => {
    if (!getTrashFocused() && open && !minimized) {
      setTrashFocused(true);
      render();
    }
  });

  installTitlebarDrag(chrome, { spring: false, yMin: 24 });

  subscribe(render);
  renderTrash();
  render();
}
