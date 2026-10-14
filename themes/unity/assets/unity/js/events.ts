// The custom DOM events the desktop's bundles and a site's own scripts
// exchange. The module has no side effects, so every bundle can import it,
// and esbuild copies the names into each one. README.md documents the
// events a site's scripts use.

import type { UPPageWindowState } from "./types";

/** Fires on document once the desktop has started. */
export const READY_EVENT = "up:ready";

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

declare global {
  interface DocumentEventMap {
    [READY_EVENT]: CustomEvent<null>;
  }
  interface WindowEventMap {
    [WINDOW_STATE_EVENT]: CustomEvent<UPPageWindowState>;
    [NOTIFY_EVENT]: CustomEvent<UPNotifyDetail>;
  }
}
