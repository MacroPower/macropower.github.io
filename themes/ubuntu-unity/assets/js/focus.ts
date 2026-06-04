// Which floating window (trash, studio) currently has focus, if any. A single
// slot models Unity's focus rules: focusing one window implicitly unfocuses the
// others, and the page window is focused exactly when no overlay window is.
// page-window.ts, trash.ts, daw.ts, and top-panel.ts all subscribe so only one
// window/title looks focused at a time.

export type OverlayWindow = "trash" | "studio";

type FocusListener = (focused: boolean) => void;

const subs = new Set<FocusListener>();
let focusedWin: OverlayWindow | null = null;

function setFocused(win: OverlayWindow, v: boolean): void {
  const next = v ? win : (focusedWin === win ? null : focusedWin);
  if (focusedWin === next) return;
  focusedWin = next;
  subs.forEach((fn) => fn(focusedWin !== null));
}

export function setTrashFocused(v: boolean): void {
  setFocused("trash", Boolean(v));
}

export function getTrashFocused(): boolean {
  return focusedWin === "trash";
}

export function setStudioFocused(v: boolean): void {
  setFocused("studio", Boolean(v));
}

export function getStudioFocused(): boolean {
  return focusedWin === "studio";
}

// True while any overlay window has focus (i.e. the page window does not).
export function getOverlayFocused(): boolean {
  return focusedWin !== null;
}

// Hand focus back to the page window, whichever overlay held it.
export function clearOverlayFocus(): void {
  if (focusedWin !== null) setFocused(focusedWin, false);
}

export function subscribe(fn: FocusListener): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
