// Typed access to DOM nodes without type assertions. DOM events and focus
// report a node as the wider EventTarget or Element. The event and focus
// helpers check the node's type at run time, so a node of another kind
// yields null rather than a mistyped value. requireAll() narrows a
// module's lookups to non-null types together.

/** The event's target when it is an Element, which includes SVG icons. */
export function eventElement(e: Event): Element | null {
  return e.target instanceof Element ? e.target : null;
}

/** The event's target when it is an HTMLElement. */
export function eventHTMLElement(e: Event): HTMLElement | null {
  return e.target instanceof HTMLElement ? e.target : null;
}

/** The focused element when it is an HTMLElement. */
export function focusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

/** The focused element's position in items, or -1 when focus is elsewhere. */
export function indexOfFocused(items: readonly HTMLElement[]): number {
  const cur = focusedElement();
  return cur ? items.indexOf(cur) : -1;
}

/** Whether a desktop overlay covers the page: a dialog, the lock screen,
 *  the Dash, or the HUD. It reads the DOM, so a page bundle gets the same
 *  answer as the app bundle, which opens the overlays. */
export function overlayOpen(): boolean {
  const host = document.getElementById("up-dialog-host");
  if (host && host.childElementCount > 0) return true;
  return Array.from(document.querySelectorAll<HTMLElement>("[data-up-lock], [data-up-dash], [data-up-hud]"))
    .some((el) => !el.hidden);
}

/** The lookups when none is null or undefined, or null when any is.
 *  Destructure the result into consts after the null check. A guard's
 *  narrowing stops at a function declaration, but each const's own type
 *  is non-null, so the functions that read it do not need `!`. */
export function requireAll<T extends Record<string, unknown>>(
  lookups: T,
): { [K in keyof T]: NonNullable<T[K]> } | null {
  if (Object.values(lookups).some((v) => v == null)) return null;
  // The check above proves every value non-null.
  return lookups as { [K in keyof T]: NonNullable<T[K]> };
}
