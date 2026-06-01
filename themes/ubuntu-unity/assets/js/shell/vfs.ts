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

// An executable stub for a /bin or /usr/bin program. Lets `which`, `type`,
// `ls`, and `test -x` agree on where a command lives without shipping real
// machine code; `cat` shows a file(1)-style line instead of dumping bytes. The
// size is a stable function of the name so listings never jitter.
function binary(name: string): FileNode {
  return file(name, {
    mode: "755",
    mtime: "2024-01-01",
    size: 26000 + name.length * 137,
    content: () => [
      color(
        PALETTE.muted,
        `${name}: ELF 64-bit LSB executable, x86-64 (binary)`,
      ),
    ],
  });
}

// Any execute bit set in the octal mode marks a node runnable -- the predicate
// the PATH search and `test -x` share.
function isExecutable(node: FsNode): boolean {
  return [...node.mode].some((d) => Number(d) & 1);
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

  // Drop an executable stub at /usr/bin/<name> so command introspection and the
  // filesystem agree on where each external program lives. No-op when /usr/bin
  // is absent.
  installBinary(name: string): void {
    const bin = this.lookup("/usr/bin");
    if (bin?.kind === "dir") bin.children.set(name, binary(name));
  }

  // Resolve a command word the way the shell's path search does: an explicit
  // path (one containing "/") is checked relative to `cwd`; a bare name is
  // searched across the colon-separated `path`. Returns the absolute path of the
  // first executable file found, or undefined -- the seam `which`/`type` share.
  resolveCommand(name: string, cwd: string, path: string): string | undefined {
    if (name.includes("/")) {
      const abs = this.resolvePath(cwd, name);
      const node = this.lookup(abs);
      return node?.kind === "file" && isExecutable(node) ? abs : undefined;
    }
    for (const segment of path.split(":")) {
      if (segment === "") continue;
      const abs = this.resolvePath(cwd, `${segment}/${name}`);
      const node = this.lookup(abs);
      if (node?.kind === "file" && isExecutable(node)) return abs;
    }
    return undefined;
  }

  // Collapse home to ~ for the prompt, matching bash.
  displayPath(absPath: string): string {
    if (absPath === this.homePath) return "~";
    if (absPath.startsWith(`${this.homePath}/`))
      return `~${absPath.slice(this.homePath.length)}`;
    return absPath;
  }

  // Expand a filename glob against the tree, returning matches shaped like the
  // input (absolute if the pattern was, relative to `cwd` otherwise), sorted.
  // Returns [] when nothing matches -- the caller keeps the literal pattern,
  // matching bash with nullglob off.
  glob(cwd: string, pattern: string): string[] {
    const isAbs = pattern.startsWith("/");
    const segs = pattern.split("/").filter((s) => s !== "");
    const start = isAbs ? this.root : this.lookup(cwd);
    if (!start || start.kind !== "dir") return [];

    const join = (prefix: string, name: string): string =>
      prefix === "" ? name : prefix === "/" ? `/${name}` : `${prefix}/${name}`;

    let frontier: { node: FsNode; path: string }[] = [{ node: start, path: isAbs ? "/" : "" }];
    for (const seg of segs) {
      const next: { node: FsNode; path: string }[] = [];
      if (/[*?[]/.test(seg)) {
        const re = globToRegExp(seg, { leadingDot: true });
        for (const f of frontier) {
          if (f.node.kind !== "dir") continue;
          for (const name of [...f.node.children.keys()].sort()) {
            const child = f.node.children.get(name);
            if (child && re.test(name)) next.push({ node: child, path: join(f.path, name) });
          }
        }
      } else {
        for (const f of frontier) {
          if (f.node.kind !== "dir") continue;
          const child = f.node.children.get(seg);
          if (child) next.push({ node: child, path: join(f.path, seg) });
        }
      }
      frontier = next;
    }
    return frontier.map((f) => f.path).sort();
  }
}

// Compile a shell glob pattern (* ? [...]) to a RegExp source (no anchors).
// `*` matches any run (including "/", as bash does for ${VAR#pat} patterns).
export function globToRegExpBody(pat: string): string {
  let re = "";
  let i = 0;
  while (i < pat.length) {
    const c = pat[i] ?? "";
    if (c === "*") { re += ".*"; i += 1; continue; }
    if (c === "?") { re += "."; i += 1; continue; }
    if (c === "[") {
      let j = i + 1;
      let neg = false;
      if (pat[j] === "!" || pat[j] === "^") { neg = true; j += 1; }
      let cls = "";
      if (pat[j] === "]") { cls += "\\]"; j += 1; }
      while (j < pat.length && pat[j] !== "]") {
        const ch = pat[j] ?? "";
        cls += ch === "\\" ? "\\\\" : ch;
        j += 1;
      }
      if (j >= pat.length) { re += "\\["; i += 1; continue; } // unterminated -> literal
      re += `[${neg ? "^" : ""}${cls}]`;
      i = j + 1;
      continue;
    }
    re += c.replace(REGEX_META, "\\$&");
    i += 1;
  }
  return re;
}

const REGEX_META = /[.*+?^${}()|[\]\\]/;

// Anchored full-match RegExp for a glob pattern. With `leadingDot`, a pattern
// that starts with a metacharacter does not match a leading "." -- the
// filename-globbing rule; parameter-expansion patterns leave it off.
export function globToRegExp(pat: string, opts: { leadingDot?: boolean } = {}): RegExp {
  const guard = opts.leadingDot && /[*?[]/.test(pat[0] ?? "") ? "(?!\\.)" : "";
  return new RegExp(`^${guard}${globToRegExpBody(pat)}$`);
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

  // A small FHS skeleton so the paths the shell advertises actually exist:
  // `/bin/bash` (the seeded $SHELL), the PATH dirs `which` searches, and a
  // writable-looking `/tmp`. The command stubs under `/usr/bin` are injected
  // after registration (see Shell.register) so they never drift from the
  // registry.
  const root = dir("/", {
    mtime: "2025-07-13",
    children: [
      dir("bin", {
        mtime: "2024-01-01",
        children: [binary("bash"), binary("sh")],
      }),
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
      dir("home", { mtime: "2025-07-13", children: [home] }),
      dir("tmp", { mtime: "2025-07-13", children: [] }),
      dir("usr", {
        mtime: "2024-01-01",
        children: [
          dir("bin", { mtime: "2024-01-01", children: [] }),
          dir("local", {
            mtime: "2024-01-01",
            children: [dir("bin", { mtime: "2024-01-01", children: [] })],
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
