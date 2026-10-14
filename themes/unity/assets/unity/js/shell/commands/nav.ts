import { safeNavUrl } from "../../url";

// The sole window.location wrapper, kept isolated here so the rest of the
// shell (and the VFS) stays DOM-free.

/** Navigates the browser to path and returns true. Returns false without
 *  navigating when safeNavUrl() refuses path. */
export function navigate(path: string): boolean {
  const url = safeNavUrl(path, window.location.href);
  if (url === null) return false;
  window.location.assign(url);
  return true;
}
