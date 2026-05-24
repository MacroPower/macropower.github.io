type FocusListener = (focused: boolean) => void;

const subs = new Set<FocusListener>();
let trashFocused = false;

export function setTrashFocused(v: boolean): void {
  const next = Boolean(v);
  if (trashFocused === next) return;
  trashFocused = next;
  subs.forEach((fn) => fn(trashFocused));
}

export function getTrashFocused(): boolean {
  return trashFocused;
}

export function subscribe(fn: FocusListener): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}
