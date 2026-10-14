// The script API for a site's own scripts, which import it as
// "unity/js/api" and bundle it with js.Build. README.md documents it.
// Every export is public surface that sites depend on, so keep the exports
// few, and api.test.ts lists them. Each site's bundle runs the top-level
// code of every module this one imports, so import only modules without
// side effects.

import { emitWindow, NOTIFY_EVENT, READY_CLASS, READY_EVENT, type UPNotifyDetail } from "./events";
import type { UPDialogOptions } from "./types";

export { NOTIFY_EVENT, READY_EVENT, type UPNotifyDetail };
export type { UPDialogButton, UPDialogIcon, UPDialogOptions } from "./types";

/** Resolves when the desktop has started, or at once if it already has. */
export function whenReady(): Promise<void> {
  // A script that runs in <head> before the parser reaches <body> reads a
  // null document.body, and the desktop has not started then either.
  if (document.body?.classList.contains(READY_CLASS)) return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener(READY_EVENT, () => resolve(), { once: true });
  });
}

/** Raises a notification bubble. A call made before the desktop starts
 *  raises the bubble when the desktop starts. */
export function notify(detail: UPNotifyDetail): void {
  void whenReady().then(() => emitWindow(NOTIFY_EVENT, detail));
}

/** Opens a dialog when the desktop has started. Resolves to the id of the
 *  button that closed the dialog, or to null when Escape or the close
 *  button closed it or when the page has no dialogs. tsc infers `Id` from
 *  the ids in `buttons`, and a dialog without `buttons` shows one button
 *  whose id is "ok". */
export async function dialog<const Id extends string = "ok">(opts: UPDialogOptions<Id>): Promise<Id | null> {
  await whenReady();
  return (await window.uiDialog?.(opts)) ?? null;
}
