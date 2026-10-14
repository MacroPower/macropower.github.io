// The home terminal's virtual filesystem: pure data and path logic, with no
// tie to the DOM or xterm, like the renderer-agnostic shell core. Everything
// is static. Sizes, modes, and mtimes come from literals and never from Date
// or Math.random, so `ls` and `ls -l` render the same on every run. File
// bodies are thunks, so they fill in ShellData (socials, title, host) only
// when a command reads them.
//
// The tree is also writable for the session. Redirections (`>` and `>>`) and
// the file-mutation commands, such as mkdir, touch, rm, cp, and mv, change it
// in place. Writes live in memory only and reset on reload, unlike the
// command history, which persists. Every written node's mtime is the
// module-level SESSION_MTIME constant, never a real Date from a command, and
// its size is a pure function of its content. The golden `ls` and glob tests
// therefore stay deterministic.

import type { ShellData } from "./shell";
import { color, PALETTE } from "./ansi";

type NodeKind = "dir" | "file";

// The mtime stamped on every node created or rewritten during the session. A
// fixed literal (not `new Date()`) so written-file listings stay reproducible,
// consistent with the static `binary()` mtime.
export const SESSION_MTIME = "2025-07-13";

// Split a buffer into stored file lines. It breaks on "\n", drops a trailing
// "\r" from each line, and discards the trailing empty element that a final
// newline leaves. A pipeline capture (CaptureSink.lines in shell.ts) and
// Vfs.writeFile both call it, so `echo hi > f; cat f` yields one line and
// not a spurious blank.
export function splitLines(s: string): string[] {
  const parts = s.split("\n").map((l) => l.replace(/\r$/, ""));
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

interface BaseNode {
  name: string;
  kind: NodeKind;
  mode: string;
  mtime: string;
  size: number;
  url?: string | undefined;
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
] as const;

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
    url?: string | undefined;
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
  opts: { mtime: string; url?: string | undefined; children: FsNode[] },
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

// An executable stub for a /bin or /usr/bin program. It lets `which`, `type`,
// `ls`, and `test -x` agree on where a command lives without shipping real
// machine code, and `cat` shows a file(1)-style line instead of dumping bytes.
// The size is a stable function of the name, so listings never jitter.
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

// Any execute bit in the octal mode marks a node runnable. The PATH search and
// `test -x` share this predicate.
function isExecutable(node: FsNode): boolean {
  return [...node.mode].some((d) => Number(d) & 1);
}

// A file that the session creates or rewrites. `content` closes over the
// stored lines, and the caller passes `size`, a pure function of the raw
// buffer.
function writtenFile(name: string, lines: string[], size: number): FileNode {
  return {
    name,
    kind: "file",
    mode: "644",
    mtime: SESSION_MTIME,
    size,
    content: () => lines,
  };
}

// A directory created during the session (mkdir).
function newDir(name: string): DirNode {
  return { name, kind: "dir", mode: "755", mtime: SESSION_MTIME, size: 4096, children: new Map() };
}

// Deep-clone a node under a name, new or the same, for cp. The clone gets its
// own child Maps, so it stays independent. FileNode content thunks never
// change, so the clone can share the reference.
function cloneNode(node: FsNode, name: string): FsNode {
  if (node.kind === "file") return { ...node, name };
  const children = new Map<string, FsNode>();
  for (const [key, child] of node.children) children.set(key, cloneNode(child, key));
  return { ...node, name, children };
}

// Split an absolute path into its parent directory path and final component.
// "/" -> { parentPath: "/", base: "" }; "/a" -> { "/", "a" }.
function splitPath(absPath: string): { parentPath: string; base: string } {
  const slash = absPath.lastIndexOf("/");
  return {
    parentPath: slash <= 0 ? "/" : absPath.slice(0, slash),
    base: absPath.slice(slash + 1),
  };
}

export class Vfs {
  readonly root: DirNode;
  readonly homePath: string;

  constructor(root: DirNode, homePath: string) {
    this.root = root;
    this.homePath = homePath;
  }

  // Normalize `input` against `cwd` to an absolute path with no trailing slash
  // (root stays "/"). A leading ~ expands to home. Absolute input starts from
  // root, and relative input from cwd. Each `.` and empty segment drops, and
  // each `..` pops one segment but never past root.
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

  // --- Session write API ----------------------------------------------------
  // Each mutator takes an absolute path (callers resolve through resolvePath)
  // and returns a bash-style failure reason, such as "Is a directory", or
  // undefined on success. Callers prepend their own `cmd: name:` prefix, the
  // way `cat` and `ls` format diagnostics. A few lowercase sentinel reasons
  // ("omitting directory", "same file", "into itself") are the exception,
  // because their GNU messages do not fit that format. The cp and mv wrappers
  // rephrase those.
  //
  // Writes are permissive, so a command can write any path whose parent
  // directory exists. The VFS does not model per-file permissions, but it
  // reproduces bash's structural errors.

  // Create, overwrite, or (with append) extend a file. splitLines turns the
  // buffer into stored lines like a pipeline capture, and every other byte,
  // ANSI included, stays as written. `cat` then emits the bytes again, and
  // the text filters strip the ANSI on read.
  writeFile(absPath: string, raw: string, opts: { append?: boolean } = {}): string | undefined {
    if (absPath === "/") return "Is a directory";
    const { parentPath, base } = splitPath(absPath);
    const parent = this.lookup(parentPath);
    if (!parent) return "No such file or directory";
    if (parent.kind !== "dir") return "Not a directory";
    const existing = parent.children.get(base);
    if (existing?.kind === "dir") return "Is a directory";
    const newLines = splitLines(raw);
    if (opts.append && existing?.kind === "file") {
      const lines = [...existing.content(), ...newLines];
      parent.children.set(base, writtenFile(base, lines, existing.size + raw.length));
    } else {
      parent.children.set(base, writtenFile(base, newLines, raw.length));
    }
    return undefined;
  }

  // Create a directory. With `parents` (mkdir -p), it also creates each
  // missing parent, and an existing target is not an error.
  mkdir(absPath: string, opts: { parents?: boolean } = {}): string | undefined {
    if (absPath === "/") return opts.parents ? undefined : "File exists";
    if (opts.parents) {
      let node: FsNode = this.root;
      for (const seg of absPath.split("/").filter(Boolean)) {
        if (node.kind !== "dir") return "Not a directory";
        const next = node.children.get(seg);
        if (!next) { const d = newDir(seg); node.children.set(seg, d); node = d; }
        else node = next;
      }
      return node.kind === "dir" ? undefined : "Not a directory";
    }
    const { parentPath, base } = splitPath(absPath);
    const parent = this.lookup(parentPath);
    if (!parent) return "No such file or directory";
    if (parent.kind !== "dir") return "Not a directory";
    if (parent.children.has(base)) return "File exists";
    parent.children.set(base, newDir(base));
    return undefined;
  }

  // Remove a path. Backs both `rm` (recursive removes a non-empty dir) and
  // `rmdir`/`rm -d` (dirOnly: the target must be an empty directory).
  removePath(absPath: string, opts: { recursive?: boolean; dirOnly?: boolean; noPreserveRoot?: boolean } = {}): string | undefined {
    if (absPath === "/") {
      // Root can only be emptied once `rm` has cleared the --preserve-root
      // failsafe; "/" itself has no parent to unlink, so we clear its children.
      // Session-scoped, so a reload brings the tree back.
      if (opts.recursive && opts.noPreserveRoot) { this.root.children.clear(); return undefined; }
      return "Is a directory";
    }
    const { parentPath, base } = splitPath(absPath);
    const parent = this.lookup(parentPath);
    if (parent?.kind !== "dir") return "No such file or directory";
    const node = parent.children.get(base);
    if (!node) return "No such file or directory";
    if (opts.dirOnly) {
      if (node.kind !== "dir") return "Not a directory";
      if (node.children.size > 0) return "Directory not empty";
    } else if (node.kind === "dir" && !opts.recursive) {
      return "Is a directory";
    }
    parent.children.delete(base);
    return undefined;
  }

  // Copy src to dst (deep clone). A directory source needs `recursive`. When dst
  // is an existing directory, the copy lands in it under src's basename, like
  // bash. Like GNU cp, copy refuses a node onto itself ("same file") and a
  // directory into its own subtree ("into itself") with a sentinel reason. The
  // missing-parent check runs first, because GNU reports ENOENT before the
  // into-itself diagnostic.
  copy(srcAbs: string, dstAbs: string, opts: { recursive?: boolean } = {}): string | undefined {
    const src = this.lookup(srcAbs);
    if (!src) return "No such file or directory";
    if (src.kind === "dir" && !opts.recursive) return "omitting directory";
    const targetPath = this.dropTarget(src, dstAbs);
    const { parentPath, base } = splitPath(targetPath);
    const parent = this.lookup(parentPath);
    if (parent?.kind !== "dir") return "No such file or directory";
    if (targetPath === srcAbs) return "same file";
    if (src.kind === "dir" && targetPath.startsWith(`${srcAbs}/`)) return "into itself";
    parent.children.set(base, cloneNode(src, base));
    return undefined;
  }

  // Move or rename src to dst by relinking it, without a clone. When dst is an
  // existing directory, src lands in it under its basename. Relinking a
  // directory inside its own subtree would detach it into an unreachable
  // self-cycle and lose its data without a word. So move refuses a target
  // equal to src ("same file") or under it ("into itself") before it changes
  // anything. The mv wrapper rephrases both sentinel reasons, as the cp
  // wrapper does "omitting directory". The subtree guard applies only to a
  // directory source. A path under a *file* src falls through to the
  // structural parent checks, as in GNU mv.
  move(srcAbs: string, dstAbs: string): string | undefined {
    const src = this.lookup(srcAbs);
    if (!src) return "No such file or directory";
    const { parentPath: sp, base: sb } = splitPath(srcAbs);
    const srcParent = this.lookup(sp);
    if (srcParent?.kind !== "dir") return "No such file or directory";
    const targetPath = this.dropTarget(src, dstAbs);
    const { parentPath: dp, base: db } = splitPath(targetPath);
    const dstParent = this.lookup(dp);
    if (dstParent?.kind !== "dir") return "No such file or directory";
    if (targetPath === srcAbs) return "same file";
    if (src.kind === "dir" && targetPath.startsWith(`${srcAbs}/`)) return "into itself";
    srcParent.children.delete(sb);
    src.name = db;
    dstParent.children.set(db, src);
    return undefined;
  }

  // Create an empty file at a missing path. An existing path stays as it is,
  // mtime included, so listings stay deterministic.
  touch(absPath: string): string | undefined {
    if (this.lookup(absPath)) return undefined;
    return this.writeFile(absPath, "");
  }

  // Resolve the effective write path for cp and mv. When dst is an existing
  // directory, append src's basename, and otherwise keep dst as it is.
  private dropTarget(src: FsNode, dstAbs: string): string {
    const dst = this.lookup(dstAbs);
    if (dst?.kind === "dir") return dstAbs === "/" ? `/${src.name}` : `${dstAbs}/${src.name}`;
    return dstAbs;
  }

  // Resolve a command word the way the shell's path search does. It checks an
  // explicit path, one that contains "/", relative to `cwd`, and it searches
  // the colon-separated `path` for a bare name. Returns the absolute path of
  // the first executable file it finds, or undefined. `which` and `type` share
  // this method.
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

  // Collapse home to ~ for the prompt, as bash does.
  displayPath(absPath: string): string {
    if (absPath === this.homePath) return "~";
    if (absPath.startsWith(`${this.homePath}/`))
      return `~${absPath.slice(this.homePath.length)}`;
    return absPath;
  }

  // Expand a filename glob against the tree. Returns the matches sorted, each
  // absolute when the pattern is and relative to `cwd` otherwise. Returns []
  // when nothing matches, and the caller then keeps the literal pattern, as
  // bash does with nullglob off.
  glob(cwd: string, pattern: string): string[] {
    const isAbs = pattern.startsWith("/");
    const segs = pattern.split("/").filter((s) => s !== "");
    const start = isAbs ? this.root : this.lookup(cwd);
    if (start?.kind !== "dir") return [];

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
// that starts with a metacharacter does not match a leading ".". Filename
// globbing follows that rule, and parameter-expansion patterns leave it off.
export function globToRegExp(pat: string, opts: { leadingDot?: boolean } = {}): RegExp {
  const guard = opts.leadingDot && /[*?[]/.test(pat[0] ?? "") ? "(?!\\.)" : "";
  return new RegExp(`^${guard}${globToRegExpBody(pat)}$`);
}

export function buildFs(data: ShellData): Vfs {
  const homePath = `/home/${data.handle}`;
  const host = data.host;
  const blogDir = data.blog?.dir ?? "posts";

  // An undated post or page has the date "". Its node takes SESSION_MTIME,
  // and a post's card leaves out the date.
  const postNodes = data.posts.map((post) => {
    const posted = [post.date && `Posted ${post.date}`, post.categories.join(", ")]
      .filter(Boolean).join(" - ");
    return file(`${post.slug}.md`, {
      mtime: post.date || SESSION_MTIME,
      size: 1200 + post.slug.length * 7,
      url: post.url,
      content: () => [
        color(PALETTE.fg, post.title),
        ...(posted ? [color(PALETTE.muted, posted)] : []),
        `${color(PALETTE.red, "Read: ")}${color(PALETTE.blue, post.permalink)}`,
        color(PALETTE.muted, `(run \`open ${blogDir}/${post.slug}.md\` to read it)`),
      ],
    });
  });

  // Top-level pages cat their raw markdown; `open` follows the real permalink.
  const pageNodes = data.pages.map((page) =>
    file(`${page.slug}.md`, {
      mtime: page.date || SESSION_MTIME,
      size: page.content.length,
      url: page.url,
      content: () => {
        const body = page.content.replace(/^\n+|\n+$/g, "");
        return body ? body.split("\n") : [];
      },
    }),
  );

  // ~/README.md prints the home page's own Markdown when it has any, and
  // otherwise a welcome whose hints name only things this site has.
  const firstSocial = data.socials[0]?.label;
  const hints = ["ls", ...(data.blog ? [`cd ${blogDir}`] : []), "cat about.txt",
    ...(firstSocial ? [`open ${firstSocial}`] : []), "help"];
  const readme = data.readme
    ? file("README.md", {
      mtime: "2025-07-13",
      size: data.readme.length,
      content: () => data.readme!.replace(/^\n+|\n+$/g, "").split("\n"),
    })
    : file("README.md", {
      mtime: "2025-07-13",
      size: 412,
      content: () => [
        color(PALETTE.fg, `Welcome to ${data.name}'s terminal.`),
        color(PALETTE.muted, `Try: ${hints.join(", ")}.`),
      ],
    });

  const home = dir(data.handle, {
    mtime: "2025-07-13",
    children: [
      readme,
      file("about.txt", {
        mtime: "2024-11-02",
        size: 256,
        content: () =>
          [
            infoRow("name", data.name),
            data.title ? infoRow("title", data.title) : "",
            data.focus ? infoRow("focus", data.focus) : "",
            infoRow("uptime", data.uptime),
          ].filter(Boolean),
      }),
      ...pageNodes,
      ...(data.blog
        ? [
            dir(blogDir, {
              mtime: "2025-07-13",
              url: data.blog.url,
              children: postNodes,
            }),
          ]
        : []),
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
  // writable-looking `/tmp`. Shell.register adds the command stubs under
  // `/usr/bin` as it registers each command, so they never drift from the
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

/** The `drwxr-xr-x` or `-rw-r--r--` string for a node's kind and octal mode. */
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
// leaf. It hides dotfiles unless the leaf itself starts with ".". A directory
// part that resolves to nothing or to a file yields [], and it never throws.
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
  if (node?.kind !== "dir") return [];
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
