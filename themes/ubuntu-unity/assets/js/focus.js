const subs = new Set();
let trashFocused = false;

export function setTrashFocused(v) {
  const next = !!v;
  if (trashFocused === next) return;
  trashFocused = next;
  subs.forEach((fn) => fn(trashFocused));
}

export function getTrashFocused() {
  return trashFocused;
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
