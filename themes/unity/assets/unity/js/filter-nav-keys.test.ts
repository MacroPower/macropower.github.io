// Checks for the keyboard map of the post list and the projects grid in
// filter-nav-keys.ts. Each case names the modifiers that are down and
// the list's axis, then checks the intent that filterNavKey() returns
// for a key.

import { describe, expect, it } from "vitest";

import { filterNavKey, type FilterNavAxis, type KeyModifiers } from "./filter-nav-keys";

const plain: KeyModifiers = { ctrl: false, alt: false, meta: false, shift: false };
const shift: KeyModifiers = { ...plain, shift: true };
const chords: readonly KeyModifiers[] = [
  { ...plain, ctrl: true },
  { ...plain, alt: true },
  { ...plain, meta: true },
];
const axes: readonly FilterNavAxis[] = ["vertical", "both"];

const LIST_KEYS: readonly string[] = ["ArrowDown", "ArrowUp", "j", "k", "Home", "End", "Enter"];
const GRID_KEYS: readonly string[] = [...LIST_KEYS, "ArrowLeft", "ArrowRight", "h", "l"];

describe("filterNavKey", () => {
  it("moves the cursor on the arrows, the vi keys, Home, and End", () => {
    for (const axis of axes) {
      expect(filterNavKey("ArrowDown", plain, axis)).toEqual({ kind: "move", to: "next" });
      expect(filterNavKey("j", plain, axis)).toEqual({ kind: "move", to: "next" });
      expect(filterNavKey("ArrowUp", plain, axis)).toEqual({ kind: "move", to: "prev" });
      expect(filterNavKey("k", plain, axis)).toEqual({ kind: "move", to: "prev" });
      expect(filterNavKey("Home", plain, axis)).toEqual({ kind: "move", to: "first" });
      expect(filterNavKey("End", plain, axis)).toEqual({ kind: "move", to: "last" });
    }
  });

  it("steps along a row of a grid on Left, Right, h, and l", () => {
    expect(filterNavKey("ArrowLeft", plain, "both")).toEqual({ kind: "inline", key: "ArrowLeft" });
    expect(filterNavKey("h", plain, "both")).toEqual({ kind: "inline", key: "ArrowLeft" });
    expect(filterNavKey("ArrowRight", plain, "both")).toEqual({ kind: "inline", key: "ArrowRight" });
    expect(filterNavKey("l", plain, "both")).toEqual({ kind: "inline", key: "ArrowRight" });
  });

  it("leaves Left, Right, h, and l to the browser in a list", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "h", "l"]) {
      expect(filterNavKey(key, plain, "vertical")).toBeNull();
    }
  });

  it("opens the item under the cursor on Enter", () => {
    for (const axis of axes) {
      expect(filterNavKey("Enter", plain, axis)).toEqual({ kind: "activate" });
    }
  });

  it("keeps moving on a shifted arrow, Home, or End", () => {
    expect(filterNavKey("ArrowDown", shift, "vertical")).toEqual({ kind: "move", to: "next" });
    expect(filterNavKey("End", shift, "vertical")).toEqual({ kind: "move", to: "last" });
    expect(filterNavKey("ArrowRight", shift, "both")).toEqual({ kind: "inline", key: "ArrowRight" });
  });

  it("leaves Shift+Enter to the browser", () => {
    for (const axis of axes) {
      expect(filterNavKey("Enter", shift, axis)).toBeNull();
    }
  });

  it("leaves every chord with Ctrl, Alt, or Meta to the browser", () => {
    for (const mods of chords) {
      for (const key of LIST_KEYS) expect(filterNavKey(key, mods, "vertical")).toBeNull();
      for (const key of GRID_KEYS) expect(filterNavKey(key, mods, "both")).toBeNull();
    }
  });

  it("leaves Ctrl with a vi key to the browser", () => {
    const ctrl: KeyModifiers = { ...plain, ctrl: true };
    for (const axis of axes) {
      for (const key of ["h", "j", "k", "l"]) expect(filterNavKey(key, ctrl, axis)).toBeNull();
    }
  });

  it("leaves other keys to the page", () => {
    for (const axis of axes) {
      for (const key of ["Tab", "Escape", " ", "/", "a", "J", "PageDown"]) {
        expect(filterNavKey(key, plain, axis)).toBeNull();
      }
    }
  });
});
