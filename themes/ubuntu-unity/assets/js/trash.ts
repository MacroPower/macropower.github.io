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
  const emptyBtn = chrome.querySelector<HTMLElement>("[data-trash-empty]");

  let open = false;
  let minimized = false;

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
    void window.uiDialog?.({
      icon: "info",
      title: "Trash is already empty",
      body: "There's nothing here to remove.",
    });
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
  render();
}
