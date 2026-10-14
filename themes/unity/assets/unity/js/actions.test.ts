import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  NAMED_ACTIONS, VOLUME_CONTROLS, isVolumeControl, parseAction, parseDashAction,
} from "./actions";

const layouts = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "layouts");

function templates(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return templates(path);
    return e.name.endsWith(".html") ? [path] : [];
  });
}

// A printf format or an attribute's template action stands for every
// value it prints. The scan fills each one with this sample, which every
// parametrized action accepts.
const SAMPLE = "0";

// Every action that the theme's layouts name, by the attribute that
// carries it. A template passes a dict's "action" to data-dash-action
// when it renders the Dash and to data-action everywhere else. The
// attributes that print a dict's "action" verbatim add no names of their
// own. The check cannot read an action that a template computes, so it
// reports such an action as unread.
function scan(): { panel: Map<string, string>; dash: Map<string, string>; unread: string[] } {
  const panel = new Map<string, string>();
  const dash = new Map<string, string>();
  const unread: string[] = [];
  for (const file of templates(layouts)) {
    const name = relative(layouts, file).split(sep).join("/");
    const text = readFileSync(file, "utf8").replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, "");
    const dictTarget = /^_partials\/unity\/dash(\.html$|\/)/.test(name) ? dash : panel;
    for (const m of text.matchAll(/"action"\s+(?:"([^"]*)"|\(printf\s+"([^"]*)"|(\S+))/g)) {
      const [, literal, format, other] = m;
      if (other !== undefined) unread.push(`${name}: ${m[0]}`);
      else dictTarget.set(literal ?? format!.replaceAll("%s", SAMPLE), name);
    }
    for (const m of text.matchAll(/data-(dash-)?action="([^"]*)"/g)) {
      const [, isDash, value] = m;
      if (value === "%s" || value === "{{ .action }}") continue;
      (isDash ? dash : panel).set(value!.replace(/\{\{[^}]*\}\}/g, SAMPLE), name);
    }
  }
  return { panel, dash, unread };
}

describe("template actions", () => {
  const found = scan();

  it("reads every action the layouts name", () => {
    expect(found.unread).toEqual([]);
  });

  it("names only panel actions and sound controls in data-action", () => {
    const unknown = [...found.panel].filter(([action]) => !isVolumeControl(action) && !parseAction(action));
    expect(unknown.map(([action, file]) => `${file}: ${action}`)).toEqual([]);
  });

  it("names only Dash actions in data-dash-action", () => {
    const unknown = [...found.dash].filter(([action]) => !parseDashAction(action));
    expect(unknown.map(([action, file]) => `${file}: ${action}`)).toEqual([]);
  });

  it("uses every named action and sound control", () => {
    const used = new Set([...found.panel.keys(), ...found.dash.keys()]);
    expect([...NAMED_ACTIONS, ...VOLUME_CONTROLS].filter((a) => !used.has(a))).toEqual([]);
  });
});

describe("parseAction", () => {
  it("reads the named actions and nav:<key>", () => {
    for (const action of NAMED_ACTIONS) expect(parseAction(action)).toBe(action);
    expect(parseAction("nav:blog")).toBe("nav:blog");
  });

  it("rejects names the panel does not run", () => {
    for (const raw of ["", "nav:", "dlg:", "dlg:nope", "prefs", "trash", "music:0", "vol-toggle"]) {
      expect(parseAction(raw), raw).toBeNull();
    }
  });
});

describe("parseDashAction", () => {
  it("reads the panel's actions, trash, and music:<index>", () => {
    for (const raw of ["dlg:prefs", "daw:open", "nav:cv", "trash", "music:0", "music:12"]) {
      expect(parseDashAction(raw)).toBe(raw);
    }
  });

  it("rejects names the Dash does not run", () => {
    for (const raw of ["", "studio", "prefs", "music:", "music:x", "music:-1", "vol-play"]) {
      expect(parseDashAction(raw), raw).toBeNull();
    }
  });
});
