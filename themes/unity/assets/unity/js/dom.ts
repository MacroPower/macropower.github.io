// Typed access to the nodes that DOM events and focus report as the wider
// EventTarget or Element. Each helper checks the node's type at run time
// instead of asserting it, so a node of another kind yields null rather
// than a mistyped value.

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
