// The sole window.location wrapper, kept isolated here so the rest of the
// shell (and the VFS) stays DOM-free.
export function navigate(path: string): void {
  window.location.assign(path);
}
