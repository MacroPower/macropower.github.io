import { createSelection } from "./desktop-select";
import { installTitlebarDrag } from "./drag";
import { setTrashFocused, subscribe, getTrashFocused } from "./focus";
import { isReduceMotion } from "./prefs";
import { installDesktop } from "./projects-desktop";

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
  const tiles = Array.from(chrome.querySelectorAll<HTMLElement>("[data-trash-tile]"));

  let open = false;
  let minimized = false;
  // Session-only: the trash refills on reload.
  let emptied = false;

  // Footer + empty-state painter; doubles as the selection's onRender so the
  // count tracks both removals and selection changes.
  const renderTrash = (): void => {
    const empty = emptied || tiles.length === 0;
    if (filesView) filesView.hidden = empty;
    if (emptyView) emptyView.hidden = !empty;
    if (countEl) {
      const n = selection.get().length;
      countEl.textContent = empty
        ? "0 items"
        : n > 1
          ? `${n} items selected`
          : `${tiles.length} item${tiles.length === 1 ? "" : "s"}`;
    }
    if (emptyBtn) {
      emptyBtn.disabled = empty;
      emptyBtn.textContent = empty ? "Trash is empty" : "Empty Trash";
    }
  };

  const selection = createSelection({ tiles, onRender: renderTrash });

  const finishEmpty = (): void => {
    emptied = true;
    if (filesView) filesView.classList.remove("is-removing");
    // Repaints via onRender, so the footer never reads "N items selected"
    // after the trash empties.
    selection.clear();
  };

  const doEmpty = (): void => {
    if (!filesView || isReduceMotion()) { finishEmpty(); return; }
    // Animate the tiles out, then swap to the empty state once the animation
    // lands. `onEnd` is idempotent and self-detaching; the timeout backstops a
    // missed animationend event.
    const view = filesView;
    const onEnd = (): void => {
      view.removeEventListener("animationend", onEnd);
      finishEmpty();
    };
    view.addEventListener("animationend", onEnd);
    view.classList.add("is-removing");
    setTimeout(onEnd, 500);
  };

  // Restore and Delete share the same session-only mechanics — the tiles just
  // animate out (there is nowhere real to restore to); only the dialogs differ.
  const removeFlow = (targets: HTMLElement[]): void => {
    controller?.removeTiles(targets, {
      animate: true,
      onDone: () => {
        // Each branch repaints once: finishEmpty clears the selection (which
        // renders the empty state), syncAfterChange drops the detached tiles
        // via the isConnected predicate.
        if (tiles.length === 0) finishEmpty();
        else selection.syncAfterChange();
      },
    });
  };

  const cannotOpen = async (tile: HTMLElement): Promise<void> => {
    const name = tile.dataset.name ?? "This item";
    const r = await window.uiDialog?.({
      icon: "warning",
      title: `"${name}" is in the Trash`,
      body: "Files in the Trash can't be opened. To open this item, restore it first.",
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "restore", label: "Restore", primary: true },
      ],
    });
    if (r === "restore") removeFlow([tile]);
  };

  const confirmDelete = async (targets: HTMLElement[]): Promise<void> => {
    const n = targets.length;
    const name = targets[0]?.dataset.name ?? "";
    const r = await window.uiDialog?.({
      icon: "warning",
      title: n > 1 ? `Permanently delete ${n} items?` : `Permanently delete "${name}"?`,
      body: "If you delete an item, it will be permanently lost. This can't be undone.",
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "delete", label: "Delete", primary: true, danger: true },
      ],
    });
    if (r === "delete") removeFlow(targets);
  };

  // The shared desktop gesture engine (also driving the projects grid) with
  // Nautilus trash semantics: double-click can't open, only restore;
  // right-click inside a multi-selection acts on the whole selection.
  const controller = filesView
    ? installDesktop({
        grid: filesView,
        tiles,
        get: selection.get,
        anchor: selection.anchor,
        setSingle: selection.setSingle,
        toggle: selection.toggle,
        selectRange: selection.selectRange,
        setMany: selection.setMany,
        clear: selection.clear,
        selectAllVisible: selection.selectAllVisible,
        tileSelector: "[data-trash-tile]",
        emptyAnchor: null, // the empty state is a sibling, not an in-grid placeholder
        reduceMotion: isReduceMotion,
        onOpen: (tile) => { void cannotOpen(tile); },
        tileMenu: (tile, sel) => {
          const targets = sel.includes(tile) ? sel : [tile];
          return [
            { label: "Restore", run: () => removeFlow(targets) },
            { label: "Delete from Trash", run: () => { void confirmDelete(targets); } },
          ];
        },
        // emptyMenu: the default (Select All / Clean Up Icons) is exactly right.
      })
    : null;

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
        title: `Permanently delete ${tiles.length} item${tiles.length === 1 ? "" : "s"}?`,
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
