import { describe, expect, it } from "vitest";

import { keyParts, shortcutSections, type ShortcutSection, type ShortcutSurfaces } from "./shortcuts";

// Tests run without a window, so t() returns each key as its text. Each
// test takes surfaces away from a desktop that has them all.
const ALL: ShortcutSurfaces = { hud: true, volume: true, terminal: true, blog: true, projects: true, solitaire: true };
const sections = (lacks: Partial<ShortcutSurfaces>): ShortcutSection[] => shortcutSections({ ...ALL, ...lacks });
const titles = (lacks: Partial<ShortcutSurfaces> = {}): string[] => sections(lacks).map((s) => s.title);
const descs = (lacks: Partial<ShortcutSurfaces> = {}): string[] => sections(lacks).flatMap((s) => s.rows.map((r) => r.desc));
// The keys of the row that moves the selection in the post lists and
// the projects grid.
const selectKeys = (lacks: Partial<ShortcutSurfaces> = {}): string[][] | undefined =>
  sections(lacks).flatMap((s) => s.rows).find((r) => r.desc === "js_shortcuts_move_selection")?.combos;

describe("shortcutSections", () => {
  it("lists the terminal's keys only on a desktop with the home terminal", () => {
    expect(titles()).toContain("js_shortcuts_terminal");
    expect(titles({ terminal: false })).not.toContain("js_shortcuts_terminal");
  });

  it("lists the HUD's Alt tap only on a desktop with the HUD", () => {
    expect(descs()).toContain("js_shortcuts_open_hud");
    expect(descs({ hud: false })).not.toContain("js_shortcuts_open_hud");
  });

  it("lists the volume's scroll wheel only on a desktop with the sound indicator", () => {
    expect(descs()).toContain("js_shortcuts_volume");
    expect(descs({ volume: false })).not.toContain("js_shortcuts_volume");
  });

  it("lists the solitaire keys only on a site with the solitaire page", () => {
    expect(titles()).toContain("js_shortcuts_solitaire");
    expect(titles({ solitaire: false })).not.toContain("js_shortcuts_solitaire");
    expect(descs({ solitaire: false })).not.toContain("js_shortcuts_draw_stock");
  });

  it("names the lists' section after the lists the site has", () => {
    const lists = ["js_shortcuts_blog_projects", "js_shortcuts_blog", "js_shortcuts_projects"];
    expect(titles().filter((s) => lists.includes(s))).toEqual(["js_shortcuts_blog_projects"]);
    expect(titles({ projects: false }).filter((s) => lists.includes(s))).toEqual(["js_shortcuts_blog"]);
    expect(titles({ blog: false }).filter((s) => lists.includes(s))).toEqual(["js_shortcuts_projects"]);
    expect(titles({ blog: false, projects: false }).filter((s) => lists.includes(s))).toEqual([]);
    expect(descs({ blog: false, projects: false })).not.toContain("js_shortcuts_search");
  });

  it("lists the grid's sideways keys and context menu only on a site with the projects grid", () => {
    expect(selectKeys()).toEqual([["js_shortcuts_arrows"], ["H", "J", "K", "L"]]);
    expect(selectKeys({ blog: false })).toEqual([["js_shortcuts_arrows"], ["H", "J", "K", "L"]]);
    expect(selectKeys({ projects: false })).toEqual([["js_shortcuts_arrows"], ["J", "K"]]);
    expect(descs()).toContain("js_shortcuts_context_menu");
    expect(descs({ projects: false })).not.toContain("js_shortcuts_context_menu");
  });
});

describe("keyParts", () => {
  it("joins alternatives the way the language does", () => {
    expect(keyParts([["Ctrl", "A"], ["Home"]], "en")).toEqual([{ combo: ["Ctrl", "A"] }, { join: "or" }, { combo: ["Home"] }]);
    expect(keyParts([["A"], ["B"]], "de")).toEqual([{ combo: ["A"] }, { join: "oder" }, { combo: ["B"] }]);
    expect(keyParts([["A"], ["B"], ["C"]], "en"))
      .toEqual([{ combo: ["A"] }, { join: "," }, { combo: ["B"] }, { join: ", or" }, { combo: ["C"] }]);
  });

  it("leaves a single combo alone", () => {
    expect(keyParts([["Esc"]], "en")).toEqual([{ combo: ["Esc"] }]);
  });
});
