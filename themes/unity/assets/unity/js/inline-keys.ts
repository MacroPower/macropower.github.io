// The Left and Right arrow keys along a row of controls. A row lays out
// its items in the inline direction, so on a right-to-left page the
// next item sits to the left. inlineStep() turns each key into a step
// in document order that matches the layout. inlineDirection() reads
// the direction from the element that lays out the row.

/** The direction a line of text runs in, as CSS's `direction` names it. */
export type InlineDirection = "ltr" | "rtl";

/** The horizontal arrow keys. */
export type InlineKey = "ArrowLeft" | "ArrowRight";

/** The step that Left or Right takes along a row that runs in
 *  `direction`: 1 to the next item in document order, and -1 to the
 *  previous one. */
export function inlineStep(key: InlineKey, direction: InlineDirection): 1 | -1 {
  return (key === "ArrowRight") === (direction === "ltr") ? 1 : -1;
}

/** The inline direction of an element, from its computed style. Pass
 *  the element that lays out the row, because an item with `dir="auto"`
 *  takes the direction of its own text. */
export function inlineDirection(el: Element): InlineDirection {
  return getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
}
