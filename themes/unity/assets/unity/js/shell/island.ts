// Parses the home terminal's data island, the JSON that
// _partials/unity/page/terminal.html writes into its data-shell-data
// script. A site can override that partial, so the parser checks every
// field instead of trusting the template. A wrong-typed list reads as
// empty and a wrong-typed string as "", so the terminal still starts. A
// list entry or an optional field with a wrong-typed value drops out. The
// module is DOM-free, so tests run it under Node.

import type { BlogMeta, PageMeta, PostMeta, ShellData, SocialLink } from "./shell";

/** The island's fields. It carries `since`, the YYYY-MM-DD date the
 *  uptime counts from, in place of `uptime`, which the entrypoint
 *  computes on page load. */
export type ShellIsland = Omit<ShellData, "uptime"> & { since: string };

// The fields of a `T`, each of unknown type until checked.
type Unchecked<T> = { readonly [K in keyof T]?: unknown };

function fields<T>(raw: unknown): Unchecked<T> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Unchecked<T>) : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The entries of `value` that `parse` accepts, or none when `value` is
// not an array.
function list<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: unknown) => {
    const parsed = parse(entry);
    return parsed === null ? [] : [parsed];
  });
}

function social(raw: unknown): SocialLink | null {
  const f = fields<SocialLink>(raw);
  if (!f) return null;
  const { label, url, display } = f;
  if (typeof label !== "string" || typeof url !== "string" || typeof display !== "string") return null;
  return { label, url, display };
}

function post(raw: unknown): PostMeta | null {
  const f = fields<PostMeta>(raw);
  if (!f) return null;
  const { slug, title, date, url, permalink } = f;
  if (typeof slug !== "string" || typeof title !== "string" || typeof date !== "string"
    || typeof url !== "string" || typeof permalink !== "string") return null;
  const categories = list(f.categories, (c) => (typeof c === "string" ? c : null));
  return { slug, title, date, categories, url, permalink };
}

function page(raw: unknown): PageMeta | null {
  const f = fields<PageMeta>(raw);
  if (!f) return null;
  const { slug, date, url, content } = f;
  if (typeof slug !== "string" || typeof date !== "string" || typeof url !== "string"
    || typeof content !== "string") return null;
  return { slug, date, url, content };
}

function blog(raw: unknown): BlogMeta | null {
  const f = fields<BlogMeta>(raw);
  if (!f) return null;
  const { dir, url } = f;
  return typeof dir === "string" && typeof url === "string" ? { dir, url } : null;
}

/** The island's data from its JSON text, or null when the text is not a
 *  JSON object. */
export function parseShellIsland(text: string): ShellIsland | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const f = fields<ShellIsland>(raw);
  if (!f) return null;
  const blogMeta = blog(f.blog);
  return {
    // The home directory takes its name from the handle, so an empty
    // handle falls back to the template's default login.
    handle: str(f.handle) || "user",
    host: str(f.host),
    name: str(f.name),
    title: str(f.title),
    focus: str(f.focus),
    since: str(f.since),
    socials: list(f.socials, social),
    posts: list(f.posts, post),
    pages: list(f.pages, page),
    ...(blogMeta && { blog: blogMeta }),
    ...(typeof f.readme === "string" && { readme: f.readme }),
    ...(typeof f.solitaire === "string" && { solitaire: f.solitaire }),
    ascii: str(f.ascii),
    colors: str(f.colors),
  };
}
