// Shared types for unity's TypeScript modules, plus ambient
// augmentation of `window` for the runtime surface those modules share.
// Keep in lockstep with the JS objects assigned in
// _partials/unity/ui/runtime.html (UP_SITE and UP_I18N), page-window.ts
// (UP_PAGE_WINDOW_STATE), and dialogs.ts (uiDialog). events.ts types the custom DOM events.
// contracts.test.ts checks UP_SITE and UP_I18N against a Hugo build.

export type UPDialogIcon = "info" | "question" | "warning" | "error" | "success" | "none";

/** `Id` narrows the button's id to a literal, so uiDialog's result names
 *  only the ids a call passes. */
export interface UPDialogButton<Id extends string = string> {
  /** The value the dialog resolves to when this button closes it. */
  id: Id;
  label: string;
  /** Draws the button in the accent color. */
  primary?: boolean;
  /** Marks the button destructive. When the last button carries it,
   *  focus starts on the first button that does not. */
  danger?: boolean;
}

export interface UPDialogOptions<Id extends string = string> {
  /** The titlebar text and the heading over the body. */
  title?: string;
  body?: string;
  /** Monospace text in a box under the body, such as an error's output. */
  details?: string | null;
  /** The glyph beside the text, info when absent. */
  icon?: UPDialogIcon;
  /** The buttons from left to right. Focus starts on the last one. */
  buttons?: readonly UPDialogButton<Id>[];
  /** Optional rich-content hook: receives a `.up-dlg-custom` container slotted
   *  after the body/details and before the footer. Lets a caller build live
   *  controls (e.g. the Preferences settings) without the dialog layer needing
   *  a per-control schema. */
  render?(content: HTMLElement): void;
}

/** An accent preset from params.desktop.accents. */
export interface UPAccent {
  /** The preset's key, which data-up-accent on <html> names. */
  name: string;
  /** The swatch's accessible name, in the page's language. */
  label: string;
}

export interface UPSite {
  handle: string;
  repo: string;
  rss: string;
  /** The network name the network indicator's hotspot broadcasts. */
  hotspot: string;
  /** nav:<key> action targets, from the theme's unity/site-pages.html
   *  registry. */
  nav: Record<string, string>;
  /** The accent presets the Preferences dialog offers, in swatch order. */
  accents: UPAccent[];
}

/** Runtime UI strings from the theme's _partials/unity/ui/i18n.html; read
 *  them through t() and tn() in i18n.ts. */
export interface UPI18n {
  strings: Record<string, string>;
  /** Plural keys: the distinct forms, and one digit per count from 0 to
   *  199 naming the form that count takes. */
  plurals: Record<string, { forms: string[]; index: string }>;
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
    UP_I18N?: UPI18n;
    UP_PAGE_WINDOW_STATE?: UPPageWindowState;
    /** Resolves to the id of the button that closed the dialog, or to
     *  null when Escape or the close button closed it. tsc infers `Id`
     *  from the ids in `buttons`, so comparing the result with any other
     *  id fails to compile. A dialog without `buttons` shows one button
     *  whose id is "ok". */
    uiDialog?: <const Id extends string = "ok">(opts: UPDialogOptions<Id>) => Promise<Id | null>;
  }
}
