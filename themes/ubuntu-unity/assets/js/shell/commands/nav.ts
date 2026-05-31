// Site page entries shared by ls/cd/open/cat and their completers. Paths route
// through window.location, so they must match the real Hugo permalinks.
export interface PageEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export const PAGE_ENTRIES: PageEntry[] = [
  { name: "cv", path: "/cv/", isDir: true },
  { name: "posts", path: "/posts/", isDir: true },
  { name: "projects", path: "/projects/", isDir: true },
  { name: "about", path: "/about/", isDir: false },
];

export function findPage(name: string): PageEntry | undefined {
  return PAGE_ENTRIES.find((p) => p.name === name);
}

export function navigate(path: string): void {
  window.location.assign(path);
}
