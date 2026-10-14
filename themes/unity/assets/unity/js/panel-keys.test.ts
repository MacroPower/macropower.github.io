// Checks for the panel's keyboard map in panel-keys.ts. Each case names
// where focus sits and which dropdown is open, then checks the intent
// that panelKey() returns for a key.

import { describe, expect, it } from "vitest";

import { panelKey, rowIndex, type PanelKeyState } from "./panel-keys";

const closed: PanelKeyState = { focus: "trigger", open: false, menu: false, input: false };
const onTrigger: PanelKeyState = { focus: "trigger", open: true, menu: true, input: false };
const inMenu: PanelKeyState = { focus: "dropdown", open: true, menu: true, input: false };
const inDisclosure: PanelKeyState = { focus: "dropdown", open: true, menu: false, input: false };
const onSlider: PanelKeyState = { ...inDisclosure, input: true };
const elsewhere: PanelKeyState = { focus: "elsewhere", open: true, menu: true, input: false };

describe("panelKey", () => {
  it("opens a dropdown from its trigger on the first or last row", () => {
    for (const state of [closed, onTrigger]) {
      expect(panelKey("ArrowDown", false, state)).toEqual({ kind: "open", row: "first" });
      expect(panelKey("ArrowUp", false, state)).toEqual({ kind: "open", row: "last" });
    }
  });

  it("moves through the rows of a menu and a disclosure", () => {
    for (const state of [inMenu, inDisclosure]) {
      expect(panelKey("ArrowDown", false, state)).toEqual({ kind: "move", row: "next" });
      expect(panelKey("ArrowUp", false, state)).toEqual({ kind: "move", row: "previous" });
      expect(panelKey("Home", false, state)).toEqual({ kind: "move", row: "first" });
      expect(panelKey("End", false, state)).toEqual({ kind: "move", row: "last" });
    }
  });

  it("switches to the next or previous trigger while a dropdown is open", () => {
    for (const state of [onTrigger, inMenu, inDisclosure]) {
      expect(panelKey("ArrowRight", false, state)).toEqual({ kind: "switch", step: 1 });
      expect(panelKey("ArrowLeft", false, state)).toEqual({ kind: "switch", step: -1 });
    }
    expect(panelKey("ArrowRight", false, closed)).toBeNull();
    expect(panelKey("ArrowLeft", false, closed)).toBeNull();
  });

  it("closes a menu on Tab and lets the browser move focus on", () => {
    expect(panelKey("Tab", false, inMenu)).toEqual({ kind: "close" });
  });

  it("leaves Tab to the browser in a disclosure and on a trigger", () => {
    expect(panelKey("Tab", false, inDisclosure)).toBeNull();
    expect(panelKey("Tab", false, onTrigger)).toBeNull();
  });

  it("closes the open dropdown on Escape wherever focus sits", () => {
    for (const state of [onTrigger, inMenu, inDisclosure, onSlider, elsewhere]) {
      expect(panelKey("Escape", false, state)).toEqual({ kind: "close" });
    }
    expect(panelKey("Escape", false, closed)).toBeNull();
    expect(panelKey("Escape", false, { ...elsewhere, open: false })).toBeNull();
  });

  it("leaves an input its own Left, Right, Home, and End keys", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(panelKey(key, false, onSlider)).toBeNull();
    }
    expect(panelKey("ArrowDown", false, onSlider)).toEqual({ kind: "move", row: "next" });
    expect(panelKey("ArrowUp", false, onSlider)).toEqual({ kind: "move", row: "previous" });
  });

  it("leaves every key outside the panel to the page except Escape", () => {
    for (const key of ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Tab", "Enter"]) {
      expect(panelKey(key, false, elsewhere)).toBeNull();
    }
  });

  it("leaves Home and End on a trigger to the browser", () => {
    expect(panelKey("Home", false, onTrigger)).toBeNull();
    expect(panelKey("End", false, onTrigger)).toBeNull();
  });

  it("leaves every chord with Ctrl, Alt, or Meta to the browser", () => {
    for (const key of ["ArrowDown", "ArrowLeft", "Home", "Tab", "Escape"]) {
      expect(panelKey(key, true, inMenu)).toBeNull();
      expect(panelKey(key, true, onTrigger)).toBeNull();
    }
  });

  it("leaves Enter, Space, and letters to the focused control", () => {
    for (const key of ["Enter", " ", "a"]) {
      expect(panelKey(key, false, inMenu)).toBeNull();
      expect(panelKey(key, false, onTrigger)).toBeNull();
    }
  });
});

describe("rowIndex", () => {
  it("finds the first and last row from any row", () => {
    for (const current of [-1, 0, 2, 4]) {
      expect(rowIndex("first", current, 5)).toBe(0);
      expect(rowIndex("last", current, 5)).toBe(4);
    }
  });

  it("steps to the next and previous row and wraps around the ends", () => {
    expect(rowIndex("next", 1, 5)).toBe(2);
    expect(rowIndex("next", 4, 5)).toBe(0);
    expect(rowIndex("previous", 1, 5)).toBe(0);
    expect(rowIndex("previous", 0, 5)).toBe(4);
  });

  it("starts at the first or last row when focus sits on no row", () => {
    expect(rowIndex("next", -1, 5)).toBe(0);
    expect(rowIndex("previous", -1, 5)).toBe(4);
  });

  it("finds no row in an empty dropdown", () => {
    for (const row of ["next", "previous", "first", "last"] as const) {
      expect(rowIndex(row, -1, 0)).toBe(-1);
    }
  });
});
