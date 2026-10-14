import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

// main.css without its comments.
const css = readFileSync(join(here, "..", "css", "main.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Splits a selector list at its top-level commas.
function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

interface Rule {
  selector: string;
  // The at-rules around the rule, joined, such as "@media print".
  media: string;
  decls: Map<string, string>;
}

// Every rule in source order, one entry per selector, with nesting
// resolved, so `.up-post-row { &.is-active {} }` yields
// ".up-post-row.is-active".
const rules: Rule[] = [];
{
  const open: { selectors: string[]; media: string }[] = [];
  const own: Map<string, string>[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c !== "{" && c !== ";" && c !== "}") continue;
    const text = css.slice(start, i).trim().replace(/\s+/g, " ");
    start = i + 1;
    if (c === "{") {
      const parents = open.at(-1)?.selectors ?? [];
      let media = open.at(-1)?.media ?? "";
      let selectors: string[];
      if (text.startsWith("@")) {
        selectors = parents;
        media = `${media} ${text}`.trim();
      } else if (parents.length === 0) selectors = splitList(text);
      else {
        selectors = parents.flatMap((p) =>
          splitList(text).map((s) => (s.includes("&") ? s.replaceAll("&", p) : `${p} ${s}`)));
      }
      const decls = new Map<string, string>();
      open.push({ selectors, media });
      own.push(decls);
      for (const selector of selectors) rules.push({ selector, media, decls });
      continue;
    }
    const m = /^([\w-]+)\s*:([\s\S]+)$/.exec(text);
    if (m) own.at(-1)?.set(m[1]!, m[2]!.trim());
    if (c === "}") {
      open.pop();
      own.pop();
    }
  }
}

const isForced = (r: Rule): boolean => r.media.includes("forced-colors: active");
// The rules a screen draws without forced colors.
const screen = rules.filter((r) => !isForced(r) && !r.media.includes("print"));
const forced = rules.filter(isForced);
const forcedSelectors = new Set(forced.filter((r) => r.decls.size > 0).map((r) => r.selector));

const removesOutline = (d: Map<string, string>): boolean =>
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
const STATE = /\.is-(active|on|selected|current|focused|anchor)\b|\[aria-(pressed|expanded|selected|current)/;

// The system colors forced colors keeps as written.
const SYSTEM = /\b(Canvas|CanvasText|LinkText|VisitedText|ActiveText|ButtonFace|ButtonText|ButtonBorder|Field|FieldText|Highlight|HighlightText|SelectedItem|SelectedItemText|Mark|MarkText|GrayText|AccentColor|AccentColorText)\b/;

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
      // The focused window also stacks above the others.
      ".up-window-chrome.is-focused",
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
    expect(states).toEqual(expect.arrayContaining([".up-naut-item.is-active", ".up-dash-lens.is-active", ".up-hud-row.is-selected"]));
    expect(states.filter((s) => !forcedSelectors.has(s))).toEqual([]);
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

  it("names only system colors in the forced-colors block", () => {
    const authored = forced.flatMap((r) =>
      [...r.decls]
        .filter(([, value]) => /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|color-mix)\(|var\(--/i.test(value))
        .map(([prop, value]) => `${r.selector} ${prop}:${value}`));
    expect(authored).toEqual([]);
    const colors = forced.flatMap((r) =>
      ["color", "background", "border-color", "border-inline-start-color", "outline-color"]
        .flatMap((p) => (r.decls.has(p) ? [r.decls.get(p)!] : [])));
    expect(colors.every((v) => SYSTEM.test(v) || /^(inherit|none)$/.test(v))).toBe(true);
  });
});
