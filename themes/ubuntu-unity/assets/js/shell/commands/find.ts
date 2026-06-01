// Filesystem-introspection commands: find/tree walk the VFS tree; du/stat/df/
// file report sizes and metadata. All read-only over the VFS.

import type { Command } from "../shell";
import { color, PALETTE } from "../ansi";
import { completePath, formatMode, globToRegExp, type FsNode } from "../vfs";
import { pathComplete, splitFlags } from "./text";

const red = (s: string): string => color(PALETTE.red, s);

// Children sorted by name for deterministic traversal (real find/tree follow
// readdir order; we sort so golden output is stable).
function sortedChildren(node: FsNode): FsNode[] {
  if (node.kind !== "dir") return [];
  return [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const find: Command = {
  name: "find",
  summary: "search a directory tree",
  usage: "find [PATH...] [-name PATTERN] [-type f|d]",
  details: "Walk each PATH (default '.') and print the entries it finds. -name (a glob matched against the basename) and -type (f for files, d for directories) filter what is printed, not what is descended into.",
  complete: pathComplete,
  run(ctx) {
    const args = ctx.args;
    const paths: string[] = [];
    let namePat: string | undefined;
    let typeFilter: string | undefined;
    let i = 0;
    while (i < args.length && !(args[i] as string).startsWith("-")) { paths.push(args[i] as string); i += 1; }
    for (; i < args.length; i += 1) {
      const a = args[i];
      if (a === "-name") { namePat = args[i + 1]; i += 1; }
      else if (a === "-type") { typeFilter = args[i + 1]; i += 1; }
      else { ctx.errln(red(`find: unknown predicate \`${a}'`)); return 1; }
    }
    if (paths.length === 0) paths.push(".");
    const re = namePat !== undefined ? globToRegExp(namePat, { leadingDot: true }) : null;

    const matches = (path: string, node: FsNode): boolean => {
      if (typeFilter === "f" && node.kind !== "file") return false;
      if (typeFilter === "d" && node.kind !== "dir") return false;
      if (re) return re.test((path.split("/").pop() as string) || path);
      return true;
    };

    let code = 0;
    const walk = (path: string, node: FsNode): void => {
      if (matches(path, node)) ctx.writeln(path);
      for (const child of sortedChildren(node)) {
        walk(path === "/" ? `/${child.name}` : `${path}/${child.name}`, child);
      }
    };
    for (const start of paths) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), start));
      if (!node) { ctx.errln(red(`find: '${start}': No such file or directory`)); code = 1; continue; }
      walk(start, node);
    }
    return code;
  },
};

export const tree: Command = {
  name: "tree",
  summary: "show a directory tree",
  usage: "tree [PATH]",
  details: "Print PATH (default '.') as an indented tree with branch connectors, followed by a count of directories and files. Hidden entries are omitted.",
  complete: (ctx) => completePath(ctx.vfs, ctx.cwd, ctx.current, { dirsOnly: true }),
  run(ctx) {
    const start = ctx.args.find((a) => !a.startsWith("-")) ?? ".";
    const root = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), start));
    if (!root) { ctx.errln(red(`tree: ${start}: No such file or directory`)); return 1; }
    ctx.writeln(start);
    let dirs = 0;
    let files = 0;
    const render = (node: FsNode, prefix: string): void => {
      const children = sortedChildren(node).filter((c) => !c.name.startsWith("."));
      children.forEach((child, idx) => {
        const last = idx === children.length - 1;
        const label = child.kind === "dir" ? color(PALETTE.blue, child.name) : child.name;
        ctx.writeln(`${prefix}${last ? "└── " : "├── "}${label}`);
        if (child.kind === "dir") { dirs += 1; render(child, `${prefix}${last ? "    " : "│   "}`); }
        else files += 1;
      });
    };
    render(root, "");
    ctx.writeln("");
    ctx.writeln(`${dirs} director${dirs === 1 ? "y" : "ies"}, ${files} file${files === 1 ? "" : "s"}`);
    return 0;
  },
};

// Recursive byte total: files contribute their size, directories a 4K block
// plus their contents.
function totalSize(node: FsNode): number {
  if (node.kind === "file") return node.size;
  let sum = 4096;
  for (const child of node.children.values()) sum += totalSize(child);
  return sum;
}

function humanSize(bytes: number): string {
  const units = ["", "K", "M", "G"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u += 1; }
  if (u === 0) return String(v);
  return `${v < 10 ? v.toFixed(1) : String(Math.round(v))}${units[u]}`;
}

export const du: Command = {
  name: "du",
  summary: "estimate file space usage",
  usage: "du [-sh] [PATH...]",
  details: "Summarize disk usage of each PATH (default '.'). -s prints only a grand total per argument; -h uses human-readable sizes.",
  complete: pathComplete,
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const human = flags.has("h");
    const summary = flags.has("s");
    const names = operands.length ? operands : ["."];
    const fmt = (bytes: number): string => (human ? humanSize(bytes) : String(Math.ceil(bytes / 1024)));
    let code = 0;
    for (const name of names) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), name));
      if (!node) { ctx.errln(red(`du: cannot access '${name}': No such file or directory`)); code = 1; continue; }
      if (!summary && node.kind === "dir") {
        // Print each directory's total bottom-up, returning the sum so a parent
        // reuses it instead of re-walking the subtree.
        const walk = (n: FsNode, path: string): number => {
          let sum = 4096;
          for (const c of sortedChildren(n)) sum += c.kind === "dir" ? walk(c, `${path}/${c.name}`) : c.size;
          ctx.writeln(`${fmt(sum)}\t${path}`);
          return sum;
        };
        walk(node, name);
      } else {
        ctx.writeln(`${fmt(totalSize(node))}\t${name}`);
      }
    }
    return code;
  },
};

export const stat: Command = {
  name: "stat",
  summary: "show file metadata",
  usage: "stat FILE...",
  details: "Print the size, type, mode, and modification date recorded for each file.",
  complete: pathComplete,
  run(ctx) {
    if (ctx.args.length === 0) { ctx.errln(red("stat: missing operand")); return 1; }
    const owner = ctx.data.handle;
    let code = 0;
    for (const name of ctx.args) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), name));
      if (!node) { ctx.errln(red(`stat: cannot stat '${name}': No such file or directory`)); code = 1; continue; }
      ctx.writeln(`  File: ${name}`);
      ctx.writeln(`  Size: ${node.size}\t${node.kind === "dir" ? "directory" : "regular file"}`);
      ctx.writeln(`Access: (0${node.mode}/${formatMode(node)})  Uid: ( 1000/ ${owner})   Gid: ( 1000/ ${owner})`);
      ctx.writeln(`Modify: ${node.mtime}`);
    }
    return code;
  },
};

export const df: Command = {
  name: "df",
  summary: "report filesystem disk space",
  usage: "df",
  details: "Print a static summary of the (fictional) filesystems backing this terminal.",
  run(ctx) {
    ctx.writeln("Filesystem     1K-blocks      Used Available Use% Mounted on");
    ctx.writeln("/dev/sda1       41152768  12345678  28807090  31% /");
    ctx.writeln("tmpfs            8192000         0   8192000   0% /tmp");
    return 0;
  },
};

export const file: Command = {
  name: "file",
  summary: "classify a file's type",
  usage: "file PATH...",
  details: "Describe each PATH as a directory, an empty file, ASCII text, or an executable.",
  complete: pathComplete,
  run(ctx) {
    if (ctx.args.length === 0) { ctx.errln(red("file: missing operand")); return 1; }
    let code = 0;
    for (const name of ctx.args) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), name));
      if (!node) { ctx.writeln(`${name}: cannot open \`${name}' (No such file or directory)`); code = 1; continue; }
      let desc: string;
      if (node.kind === "dir") desc = "directory";
      else if (node.mode === "755") desc = "ELF 64-bit LSB executable, x86-64";
      else desc = node.content().length === 0 ? "empty" : "ASCII text";
      ctx.writeln(`${name}: ${desc}`);
    }
    return code;
  },
};
