// Checks the page's screen-reader toolbar against controls.ts. A toolbar
// button that the table does not know has no drawn twin, so its focus
// shows nowhere on the page.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TOOLBAR_ACTIONS, isToolbarAction } from "./controls";

const here = dirname(fileURLToPath(import.meta.url));
const partial = join(here, "..", "..", "..", "..", "layouts", "_partials", "unity", "page", "solitaire.html");

describe("toolbar", () => {
  it("holds one button for each action", () => {
    const html = readFileSync(partial, "utf8");
    const ids = [...html.matchAll(/data-sol-action="([a-z-]+)"/g)].map((m) => m[1] ?? "");
    expect(ids.toSorted()).toEqual(TOOLBAR_ACTIONS.toSorted());
  });

  it("accepts only the listed actions", () => {
    expect(isToolbarAction("draw-stock")).toBe(true);
    expect(isToolbarAction("hint")).toBe(true);
    expect(isToolbarAction("banner")).toBe(false);
    expect(isToolbarAction("")).toBe(false);
  });
});
