import { describe, expect, it } from "vitest";

import { shortcutSections, type ShortcutSurfaces } from "./shortcuts";

// Tests run without a window, so t() returns each key as its text.
const titles = (has: ShortcutSurfaces): string[] => shortcutSections(has).map((s) => s.title);
const descs = (has: ShortcutSurfaces): string[] => shortcutSections(has).flatMap((s) => s.rows.map((r) => r.desc));

describe("shortcutSections", () => {
  it("lists the terminal's keys only on a desktop with the home terminal", () => {
    expect(titles({ hud: true, volume: true, terminal: true })).toContain("js_shortcuts_terminal");
    expect(titles({ hud: true, volume: true, terminal: false })).not.toContain("js_shortcuts_terminal");
  });

  it("lists the HUD's Alt tap only on a desktop with the HUD", () => {
    expect(descs({ hud: true, volume: true, terminal: true })).toContain("js_shortcuts_open_hud");
    expect(descs({ hud: false, volume: true, terminal: true })).not.toContain("js_shortcuts_open_hud");
  });

  it("lists the volume's scroll wheel only on a desktop with the sound indicator", () => {
    expect(descs({ hud: true, volume: true, terminal: true })).toContain("js_shortcuts_volume");
    expect(descs({ hud: true, volume: false, terminal: true })).not.toContain("js_shortcuts_volume");
  });
});
