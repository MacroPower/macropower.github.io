// The actions that the theme's templates write into data-action and
// data-dash-action attributes. The parsers here turn an attribute's text
// into a typed action at the DOM boundary. top-panel.ts maps every named
// action to a handler, and tsc fails when a name lacks a handler or a
// handler lacks a name. actions.test.ts reads the theme's layouts and
// fails on an action that does not parse. The module touches no DOM, so
// the tests import it under Node.

/** The panel actions with fixed names. */
export const NAMED_ACTIONS = [
  "reload", "fullscreen", "daw:open",
  "dlg:prefs", "dlg:shortcuts", "dlg:lock", "dlg:logout",
  "dlg:time", "dlg:power", "dlg:power-saver", "dlg:wired",
  "dlg:subscribe", "dlg:hotspot", "dlg:cal", "dlg:github", "dlg:launcher-info",
] as const;
export type NamedAction = (typeof NAMED_ACTIONS)[number];

/** Opens the page that the site-pages registry lists under the key. */
export type NavAction = `nav:${string}`;

/** An action that dispatchAction() in top-panel.ts runs. */
export type PanelAction = NamedAction | NavAction;

/**
 * The sound menu's own controls. top-panel.ts runs them in place and
 * keeps the menu open, so they never reach dispatchAction().
 */
export const VOLUME_CONTROLS = ["vol-toggle", "vol-play", "vol-next"] as const;
export type VolumeControl = (typeof VOLUME_CONTROLS)[number];

/** Plays the playlist track at the zero-based index. */
export type MusicAction = `music:${number}`;

/** A Dash tile's action: a panel action, the Trash, or a playlist track. */
export type DashAction = PanelAction | "trash" | MusicAction;

export function isNamedAction(raw: string): raw is NamedAction {
  return (NAMED_ACTIONS as readonly string[]).includes(raw);
}

export function isNavAction(raw: string): raw is NavAction {
  return raw.startsWith("nav:") && raw.length > "nav:".length;
}

export function isVolumeControl(raw: string): raw is VolumeControl {
  return (VOLUME_CONTROLS as readonly string[]).includes(raw);
}

export function isMusicAction(raw: string): raw is MusicAction {
  return /^music:[0-9]+$/.test(raw);
}

/** Reads a data-action value, or returns null for a name the panel lacks. */
export function parseAction(raw: string): PanelAction | null {
  return isNamedAction(raw) || isNavAction(raw) ? raw : null;
}

/** Reads a data-dash-action value, or returns null for a name the Dash lacks. */
export function parseDashAction(raw: string): DashAction | null {
  return raw === "trash" || isMusicAction(raw) ? raw : parseAction(raw);
}
