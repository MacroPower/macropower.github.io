import { describe, expect, it } from "vitest";

import { rules, type Rule } from "./testkit";

const isForced = (r: Rule): boolean => r.media.includes("forced-colors: active");
// The rules a screen draws without forced colors.
const screen = rules.filter((r) => !isForced(r) && !r.media.includes("print"));
const forced = rules.filter(isForced);
const forcedSelectors = new Set(forced.filter((r) => r.decls.size > 0).map((r) => r.selector));

const removesOutline = (d: ReadonlyMap<string, string>): boolean =>
  /^(none|0)$/.test(d.get("outline") ?? "") || d.get("all") === "unset";

// The properties whose values forced colors replaces or drops. A rule
// that sets only these, plus an outline offset, shows nothing there.
const COLOR_ONLY = new Set([
  "background", "background-color", "background-image", "color",
  "border-color", "border-left-color", "border-right-color", "border-top-color", "border-bottom-color",
  "border-inline-start-color", "border-inline-end-color",
  "box-shadow", "text-shadow", "filter", "outline-color", "outline-offset",
]);

// The class and ARIA states that mark a row, a tile, or a control as
// selected, current, pressed, or under the keyboard cursor.
const STATE = /\.is-(active|on|selected|current|focused|anchor|mute|solo)\b|\[aria-(pressed|expanded|selected|current)/;

// The system colors forced colors keeps as written.
const SYSTEM = /\b(Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText)\b/;

// The class, ARIA, and :not() parts of a selector that name a state.
const STATE_PART = /\.is-[\w-]+|\[aria-[\w-]+(?:="[^"]*")?\]|:not\([^)]*\)/g;

// The color that an outline names, from the longhand or from the last
// word of the shorthand.
const ringColor = (d: ReadonlyMap<string, string>): string | undefined =>
  d.get("outline-color") ?? d.get("outline")?.split(/\s+/).at(-1);

// Whether a background paints only gradients, with no color or image
// under them. Forced colors drops every gradient, which leaves such a
// background transparent.
const gradientOnly = (value: string): boolean => {
  let names = value;
  while (/\([^()]*\)/.test(names)) names = names.replace(/\([^()]*\)/g, "");
  const words = names.split(/[\s,]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => /^(?:repeating-)?(?:linear|radial|conic)-gradient$/.test(w));
};

// The selectors of the rules that fill with Highlight.
const fills = forced
  .filter((r) => (r.decls.get("background") ?? r.decls.get("background-color")) === "Highlight")
  .map((r) => r.selector);
// Whether a selector names a filled element, in any further state, or an
// element inside one.
const onFill = (s: string): boolean =>
  fills.some((f) => s.startsWith(f) && /^(?:$|[\s.:[])/.test(s.slice(f.length)));

// The color of each focus and cursor ring that the block names, by
// selector. A later rule replaces an earlier one.
const rings = new Map(forced
  .filter((r) => /:focus|\.is-focused\b/.test(r.selector) && ringColor(r.decls) !== undefined)
  .map((r) => [r.selector, ringColor(r.decls)!]));

describe("forced colors", () => {
  it("rings every focus state that draws no outline", () => {
    // Each of these keeps another cue, or never takes focus from a key.
    const skip = new Map([
      // The vendored xterm block. The terminal draws its own cursor.
      [".xterm.focus", "xterm"],
      [".xterm:focus", "xterm"],
      // Focus underlines the reconnect prompt, and an underline survives.
      [".up-shell-reconnect", "underline"],
      // A window takes focus only from its script, which passes keyboard
      // focus on to the window's content.
      [".up-window-chrome:focus", "script focus"],
    ]);
    const bare = screen.filter((r) => removesOutline(r.decls) && !skip.has(r.selector)).flatMap((r) => {
      const states = r.selector.includes(":focus") ? [r.selector] : [`${r.selector}:focus-visible`, `${r.selector}:focus`];
      // The last outline any rule draws on the focus state, forced or not.
      const last = rules.filter((o) => states.includes(o.selector) && o.decls.has("outline")).at(-1);
      return last && !removesOutline(last.decls) ? [] : [r.selector];
    });
    expect(bare).toEqual([]);
  });

  it("marks every state that only paints colors", () => {
    // Each of these keeps a cue that forced colors leaves alone.
    const skip = [
      // The launcher tile of the focused window shows a second arrow.
      ".up-launcher-tile.is-focused",
      // The glyph of the network row's dot changes too.
      ".up-net-row.is-on",
      // Glows that the Highlight fill under them does not need.
      ".up-naut-item.is-active .up-lang-icon",
      ".up-project-tile.is-active .up-project-folder-emblem",
    ];
    const states = screen
      .filter((r) => STATE.test(r.selector) && !/:hover|:active\b/.test(r.selector) && r.decls.size > 0)
      .filter((r) => [...r.decls.keys()].every((p) => COLOR_ONLY.has(p)))
      .map((r) => r.selector)
      .filter((s) => !skip.some((prefix) => s.startsWith(prefix)));
    expect(states).toEqual(expect.arrayContaining([
      ".up-naut-item.is-active", ".up-dash-lens.is-active", ".up-hud-row.is-selected",
      ".up-window-chrome.is-focused", ".up-window-chrome.is-focused .up-titlebar", ".up-daw-ms.is-mute",
    ]));
    expect(states.filter((s) => !forcedSelectors.has(s))).toEqual([]);
  });

  it("paints every focus ring Highlight, or HighlightText on a fill", () => {
    // Forced colors swaps the color of each ring that main.css draws for
    // one the browser picks, so the block names each ring's color.
    const drawn = screen
      .filter((r) => r.selector.includes(":focus") && !removesOutline(r.decls) && ringColor(r.decls) !== undefined)
      .map((r) => r.selector);
    expect(drawn).toEqual(expect.arrayContaining([".up-tl:focus-visible", ".up-naut-item.is-active:focus-visible"]));
    expect(drawn.filter((s) => !rings.has(s))).toEqual([]);
    const off = [...rings]
      .filter(([s, color]) => color !== (onFill(s) ? "HighlightText" : "Highlight"))
      .map(([s, color]) => `${s} ${color}`);
    expect(off).toEqual([]);
  });

  it("rings every element that opts out of forced colors", () => {
    // The browser's own ring keeps its usual color on an element that
    // opts out, so the block names the ring of each one that takes focus.
    // Each of these takes no focus, or takes its ring from another class.
    const skip = new Map([
      [".up-hud-row", "focus stays in the HUD's field"],
      [".up-docv-zoom-readout", "rings as .up-docv-btn"],
      [".up-dlg-titlebar", "takes no focus"],
    ]);
    const optOut = forced
      .filter((r) => r.decls.get("forced-color-adjust") === "none" && !/\s|::/.test(r.selector))
      .map((r) => r.selector);
    expect(optOut).toEqual(expect.arrayContaining([".up-accent-swatch", ".up-daw-patchmenu-item.is-on"]));
    const problems = optOut.flatMap((s) => {
      const base = s.replace(STATE_PART, "");
      if (skip.has(base)) return [];
      const states = [`${base}:focus-visible`, `${base}:focus`];
      if (!states.some((state) => rings.has(state))) return [`${s} draws the browser's ring`];
      // A ring inside the element's edge sits on its fill.
      const offset = rules
        .filter((r) => states.includes(r.selector) && r.decls.has("outline-offset"))
        .at(-1)?.decls.get("outline-offset") ?? "0";
      return Number.parseFloat(offset) < 0 && rings.get(`${s}:focus-visible`) !== "HighlightText"
        ? [`${s} rings its fill in Highlight`]
        : [];
    });
    expect(problems).toEqual([]);
  });

  it("edges every surface that a shadow outlines", () => {
    // A shadow with no offset or blur draws an edge, and forced colors
    // drops it with every other shadow. A rule that also draws a border
    // keeps that edge.
    const outlined = screen
      .filter((r) => !STATE.test(r.selector) && !r.selector.includes(":"))
      .filter((r) => /(?:^|,)\s*0 0 0 [\d.]+px(?![^,]*inset)/.test(r.decls.get("box-shadow") ?? ""))
      .filter((r) => ![...r.decls.keys()].some((p) => p.startsWith("border") && !p.includes("radius")))
      .map((r) => r.selector);
    expect(outlined).toEqual(expect.arrayContaining([".up-window-chrome", ".up-docv-sheet"]));
    const bare = outlined.filter((s) =>
      !forced.some((r) => r.selector === s && SYSTEM.test(r.decls.get("border") ?? r.decls.get("outline") ?? "")));
    expect(bare).toEqual([]);
  });

  it("paints a color under each floating surface that only a gradient paints", () => {
    // A surface that floats over other content, such as a menu, shows
    // that content through its text when its background turns
    // transparent. The scan counts each state of such a surface too.
    const floating = new Set(screen
      .filter((r) => /^(absolute|fixed|sticky)$/.test(r.decls.get("position") ?? ""))
      .map((r) => r.selector));
    const painted = screen
      .filter((r) => !/\s|::/.test(r.selector) && floating.has(r.selector.replace(STATE_PART, "").replace(/:[\w-]+/g, "")))
      .filter((r) => !r.decls.has("background-color") && gradientOnly(r.decls.get("background") ?? r.decls.get("background-image") ?? ""))
      .map((r) => r.selector);
    expect(painted).toEqual(expect.arrayContaining([
      ".up-dropdown", ".up-ctx-menu", ".up-dash-panel", ".up-hud-panel", ".up-post-list-header", ".up-code-copy:hover",
    ]));
    // The scan skips pseudo-elements and backgrounds that read a token.
    // The lock screen's pseudo-element paints the wallpaper token, a
    // gradient by default.
    const bare = [...painted, ".up-lock-backdrop::before"].filter((s) =>
      !forced.some((r) => r.selector === s && SYSTEM.test(r.decls.get("background-color") ?? "")));
    expect(bare).toEqual([]);
  });

  it("hides the resting bar of each row that bars its selection", () => {
    // Forced colors paints a transparent border, so without the rule a
    // resting row shows the bar that its selected state colors.
    const barred = screen
      .filter((r) => /\btransparent\b/.test(r.decls.get("border-inline-start") ?? ""))
      .map((r) => r.selector);
    expect(barred).toEqual(expect.arrayContaining([".up-naut-item", ".up-post-row"]));
    const shown = barred.filter((s) => !forced.some((r) => r.selector === s && r.decls.get("border-inline-start-color") === "Canvas"));
    expect(shown).toEqual([]);
  });

  it("fills each selection with Highlight and HighlightText", () => {
    const fills = forced.filter((r) => /^Highlight$/.test(r.decls.get("background") ?? r.decls.get("background-color") ?? ""));
    expect(fills.length).toBeGreaterThan(0);
    // A pseudo-element fill holds no text.
    const plated = fills
      .filter((r) => !r.selector.includes("::"))
      .filter((r) => r.decls.get("forced-color-adjust") !== "none" || r.decls.get("color") !== "HighlightText")
      .map((r) => r.selector);
    expect(plated).toEqual([]);
  });

  it("names a system color in each token of a control that opts out", () => {
    // A control that opts out of forced colors keeps every color it
    // reads, so each custom property that its own rule declares must name
    // a system color here.
    const kept = forced
      .filter((r) => r.decls.get("forced-color-adjust") === "none")
      .flatMap((r) => screen
        .filter((s) => s.selector === r.selector)
        .flatMap((s) => [...s.decls.keys()].filter((p) => p.startsWith("--") && !SYSTEM.test(r.decls.get(p) ?? "")))
        .map((p) => `${r.selector} ${p}`));
    expect(forced.some((r) => r.selector === ".up-vol-slider")).toBe(true);
    expect(kept).toEqual([]);
  });

  it("names only system colors in the forced-colors block", () => {
    const authored = forced.flatMap((r) =>
      [...r.decls]
        .filter(([, value]) => /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|color-mix)\(|var\(--/i.test(value))
        .map(([prop, value]) => `${r.selector} ${prop}:${value}`));
    expect(authored).toEqual([]);
    const colors = forced.flatMap((r) =>
      ["color", "background", "border", "border-color", "border-inline-start-color", "outline", "outline-color"]
        .flatMap((p) => (r.decls.has(p) ? [r.decls.get(p)!] : [])));
    expect(colors.every((v) => SYSTEM.test(v) || /^(inherit|none)$/.test(v))).toBe(true);
  });
});
