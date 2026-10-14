// The custom DOM events the desktop's bundles and a site's own scripts
// exchange. The module has no side effects, so every bundle can import it,
// and esbuild copies the names into each one. README.md documents the
// events a site's scripts use.

import type { UPPageWindowState } from "./types";

/** Fires on document once the desktop has started. */
export const READY_EVENT = "up:ready";

/** The class body carries after the desktop has started. app.ts adds it
 *  just before READY_EVENT fires, so a script that runs later reads it. */
export const READY_CLASS = "up-ready";

/** Fires on window whenever the page window opens, closes, minimizes,
 *  maximizes, or gains or loses focus. */
export const WINDOW_STATE_EVENT = "up:page-window-state";

/** Raises a NotifyOSD bubble when dispatched on window. */
export const NOTIFY_EVENT = "up:notify";

export interface UPNotifyDetail {
  summary: string;
  body?: string | undefined;
  /** A key from unity/notify-host.html's icon template, such as info or music,
   *  or a freedesktop-style alias such as dialog-information. */
  icon?: string | undefined;
  /** Display time, clamped to 1-20s like notify-send's expire-time. */
  timeoutMs?: number | undefined;
}

/** The detail of each event that fires on document, by event name. */
export interface UPDocumentEvents {
  [READY_EVENT]: null;
}

/** The detail of each event that fires on window, by event name. */
export interface UPWindowEvents {
  [WINDOW_STATE_EVENT]: UPPageWindowState;
  [NOTIFY_EVENT]: UPNotifyDetail;
}

type CustomEventMap<Details> = { [K in keyof Details]: CustomEvent<Details[K]> };

declare global {
  interface DocumentEventMap extends CustomEventMap<UPDocumentEvents> {}
  interface WindowEventMap extends CustomEventMap<UPWindowEvents> {}
}

/** Dispatches an event on document. tsc rejects a detail of the wrong
 *  type and the name of an event that fires on window. */
export function emitDocument<K extends keyof UPDocumentEvents>(type: K, detail: UPDocumentEvents[K]): void {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

/** Dispatches an event on window. tsc rejects a detail of the wrong type
 *  and the name of an event that fires on document. */
export function emitWindow<K extends keyof UPWindowEvents>(type: K, detail: UPWindowEvents[K]): void {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}
