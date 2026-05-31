// The home terminal's virtual filesystem: pure data + path logic, no DOM or
// xterm coupling (matches the renderer-agnostic shell core). Everything is
// static -- sizes, modes, and mtimes come from literals, never Date/random --
// so `ls` and `ls -l` render identically on every run. File bodies are thunks
// so they can interpolate ShellData (socials, title, host) lazily.

import type { ShellData } from "./shell";
import { color, PALETTE } from "./ansi";

type NodeKind = "dir" | "file";

interface BaseNode {
  name: string;
  kind: NodeKind;
  mode: string;
  mtime: string;
  size: number;
  url?: string;
}

export interface FileNode extends BaseNode {
  kind: "file";
  content: () => string[];
}

export interface DirNode extends BaseNode {
  kind: "dir";
  children: Map<string, FsNode>;
}

export type FsNode = FileNode | DirNode;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `name: value` row used by the about/social file bodies. */
function infoRow(label: string, value: string): string {
  return `${color(PALETTE.red, label.padEnd(7))}${color(PALETTE.fg, value)}`;
}

function file(
  name: string,
  opts: {
    mode?: string;
    mtime: string;
    size: number;
    url?: string;
    content: () => string[];
  },
): FileNode {
  return {
    name,
    kind: "file",
    mode: opts.mode ?? "644",
    mtime: opts.mtime,
    size: opts.size,
    url: opts.url,
    content: opts.content,
  };
}

function dir(
  name: string,
  opts: { mtime: string; url?: string; children: FsNode[] },
): DirNode {
  const children = new Map<string, FsNode>();
  for (const child of opts.children) children.set(child.name, child);
  return {
    name,
    kind: "dir",
    mode: "755",
    mtime: opts.mtime,
    size: 4096,
    url: opts.url,
    children,
  };
}

export class Vfs {
  constructor(
    readonly root: DirNode,
    readonly homePath: string,
  ) {}

  // Normalize `input` against `cwd` to an absolute path with no trailing slash
  // (root stays "/"). Leading ~ expands to home; absolute input restarts from
  // root, relative from cwd; `.`/empty segments drop, `..` pops (never past
  // root).
  resolvePath(cwd: string, input: string): string {
    let base: string;
    let path: string;
    if (input === "~" || input.startsWith("~/")) {
      base = this.homePath;
      path = input === "~" ? "" : input.slice(2);
    } else if (input.startsWith("/")) {
      base = "/";
      path = input;
    } else {
      base = cwd;
      path = input;
    }
    const segments = base === "/" ? [] : base.split("/").filter(Boolean);
    for (const seg of path.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        segments.pop();
        continue;
      }
      segments.push(seg);
    }
    return `/${segments.join("/")}`;
  }

  // Walk an absolute path from root. Descending into a file (or a missing
  // segment) yields undefined.
  lookup(absPath: string): FsNode | undefined {
    if (absPath === "/") return this.root;
    let node: FsNode = this.root;
    for (const seg of absPath.split("/").filter(Boolean)) {
      if (node.kind !== "dir") return undefined;
      const next = node.children.get(seg);
      if (!next) return undefined;
      node = next;
    }
    return node;
  }

  // Collapse home to ~ for the prompt, matching bash.
  displayPath(absPath: string): string {
    if (absPath === this.homePath) return "~";
    if (absPath.startsWith(`${this.homePath}/`))
      return `~${absPath.slice(this.homePath.length)}`;
    return absPath;
  }
}

export function buildFs(data: ShellData): Vfs {
  const homePath = `/home/${data.handle}`;
  const host = data.host;

  const postNodes = data.posts.map((post) =>
    file(`${post.slug}.md`, {
      mtime: post.date,
      size: 1200 + post.slug.length * 7,
      url: post.url,
      content: () => [
        color(PALETTE.fg, post.title),
        color(
          PALETTE.muted,
          `Posted ${post.date} - ${post.categories.join(", ")}`,
        ),
        `${color(PALETTE.red, "Read: ")}${color(PALETTE.blue, `https://${host}${post.url}`)}`,
        color(PALETTE.muted, `(run \`open posts/${post.slug}.md\` to read it)`),
      ],
    }),
  );

  // Top-level pages cat their raw markdown; `open` follows the real permalink.
  const pageNodes = data.pages.map((page) =>
    file(`${page.slug}.md`, {
      mtime: page.date,
      size: page.content.length,
      url: page.url,
      content: () => {
        const body = page.content.replace(/^\n+|\n+$/g, "");
        return body ? body.split("\n") : [];
      },
    }),
  );

  const home = dir(data.handle, {
    mtime: "2025-07-13",
    children: [
      file("README.md", {
        mtime: "2025-07-13",
        size: 412,
        content: () => [
          color(PALETTE.fg, `Welcome to ${data.name}'s terminal.`),
          color(
            PALETTE.muted,
            "Try: ls, cd posts, cat about.txt, open github, help.",
          ),
        ],
      }),
      file("about.txt", {
        mtime: "2024-11-02",
        size: 256,
        content: () => [
          infoRow("name", data.name),
          infoRow("title", data.title),
          infoRow("uptime", data.uptime),
        ],
      }),
      ...pageNodes,
      dir("posts", {
        mtime: "2025-07-13",
        url: "/posts/",
        children: postNodes,
      }),
      dir("projects", {
        mtime: "2023-04-03",
        url: "/projects/",
        children: [
          file("README.md", {
            mtime: "2023-04-03",
            size: 220,
            content: () => [
              color(PALETTE.fg, `Projects live at https://${host}/projects/`),
              color(PALETTE.muted, "Run `open projects` to browse them."),
            ],
          }),
        ],
      }),
      file(".social", {
        mtime: "2024-01-10",
        size: 320,
        content: () =>
          data.socials.map(
            (s) =>
              `${color(PALETTE.red, s.label.padEnd(12))}${color(PALETTE.blue, s.url)}`,
          ),
      }),
      file(".bashrc", {
        mtime: "2023-08-22",
        size: 308,
        content: () => [
          color(PALETTE.muted, "# ~/.bashrc"),
          "export EDITOR=vim",
          "export PAGER=less",
          'export PATH="$HOME/bin:$PATH"',
          "PS1='\\u@\\h:\\w\\$ '",
        ],
      }),
    ],
  });

  const root = dir("/", {
    mtime: "2025-07-13",
    children: [
      dir("home", { mtime: "2025-07-13", children: [home] }),
      dir("etc", {
        mtime: "2024-01-01",
        children: [
          file("motd", {
            mtime: "2024-01-01",
            size: 84,
            content: () => [color(PALETTE.green, `Welcome to ${host}!`)],
          }),
        ],
      }),
    ],
  });

  return new Vfs(root, homePath);
}

// Shared formatting + completion helpers used by the fs commands.

/** drwxr-xr-x / -rw-r--r-- from a node's kind + octal mode string. */
export function formatMode(node: FsNode): string {
  const rwx = (digit: number): string =>
    `${digit & 4 ? "r" : "-"}${digit & 2 ? "w" : "-"}${digit & 1 ? "x" : "-"}`;
  const type = node.kind === "dir" ? "d" : "-";
  return type + [...node.mode].map((d) => rwx(Number(d))).join("");
}

/** "Mon DD  YYYY" from a "YYYY-MM-DD" string (static month table, no Date). */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${MONTHS[Number(month) - 1]} ${String(Number(day)).padStart(2)}  ${year}`;
}

// Completes a path token against the VFS. Splits `current` into a directory
// part (kept verbatim so ~/, ../, and absolute prefixes survive) and a leaf,
// then returns full-token replacements for children whose name starts with the
// leaf. Dotfiles are hidden unless the leaf itself starts with ".". A dir-part
// that resolves to nothing or to a file yields [] -- never throws.
export function completePath(
  vfs: Vfs,
  cwd: string,
  current: string,
  opts: { dirsOnly?: boolean } = {},
): string[] {
  const slash = current.lastIndexOf("/");
  const dirPart = slash >= 0 ? current.slice(0, slash + 1) : "";
  const leaf = slash >= 0 ? current.slice(slash + 1) : current;
  const node = vfs.lookup(vfs.resolvePath(cwd, dirPart || "."));
  if (!node || node.kind !== "dir") return [];
  const showHidden = leaf.startsWith(".");
  const out: string[] = [];
  for (const child of node.children.values()) {
    if (opts.dirsOnly && child.kind !== "dir") continue;
    if (!showHidden && child.name.startsWith(".")) continue;
    if (!child.name.startsWith(leaf)) continue;
    out.push(dirPart + child.name + (child.kind === "dir" ? "/" : ""));
  }
  return out;
}
