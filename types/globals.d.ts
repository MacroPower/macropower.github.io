// Ambient declarations for the runtime surface that ubuntu-unity's modules
// share through `window`. Keep this file in lockstep with the JS objects
// assigned in baseof.html (UP_SITE), page-window.ts (UP_PAGE_WINDOW_STATE,
// WINDOW_STATE_EVENT) and dialogs.tsx (uiDialog).

export type UPDialogIcon = "info" | "question" | "warning" | "error" | "success" | "none";

export interface UPDialogButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface UPDialogOptions {
  title?: string;
  body?: string;
  details?: string | null;
  icon?: UPDialogIcon;
  buttons?: UPDialogButton[];
}

export interface UPSite {
  handle: string;
  github: string;
  rss: string;
}

export interface UPPageWindowState {
  visible: boolean;
  minimized: boolean;
  closed: boolean;
  maximized: boolean;
  focused: boolean;
}

declare global {
  interface Window {
    UP_SITE?: UPSite;
    UP_PAGE_WINDOW_STATE?: UPPageWindowState;
    uiDialog?: (opts: UPDialogOptions) => Promise<string | null>;
  }
}
