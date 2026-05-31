import type { Command, CommandContext } from "../shell";
import { color, PALETTE } from "../ansi";
import {
  completePath, formatDate, formatMode,
  type DirNode, type FsNode,
} from "../vfs";
import { navigate } from "./nav";

/** Split ls argv into flags (clustered: -la, -al, -l -a) and operands. */
function parseLsArgs(args: string[]): { flags: Set<string>; operands: string[] } {
  const flags = new Set<string>();
  const operands: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-") && arg.length > 1) {
      for (const ch of arg.slice(1)) flags.add(ch);
    } else {
      operands.push(arg);
    }
  }
  return { flags, operands };
}

export const pwd: Command = {
  name: "pwd",
  summary: "print the current directory",
  run(ctx) {
    ctx.writeln(ctx.cwd());
  },
};

interface Row {
  name: string;
  node: FsNode;
}

// Color a listing cell: dirs blue with a trailing slash, files plain. The
// synthetic . and .. entries stay bare (no slash).
function cell(row: Row): string {
  if (row.name === "." || row.name === "..") return color(PALETTE.blue, row.name);
  return row.node.kind === "dir"
    ? color(PALETTE.blue, `${row.name}/`)
    : color(PALETTE.fg, row.name);
}

// Synthetic 1K-block count, derived from the static size so `total` is stable.
function blocks(size: number): number {
  return Math.ceil(size / 4096) * 4;
}

function dirRows(node: DirNode, showAll: boolean): Row[] {
  const rest: Row[] = [];
  for (const child of node.children.values()) {
    if (!showAll && child.name.startsWith(".")) continue;
    rest.push({ name: child.name, node: child });
  }
  rest.sort((a, b) => a.name.localeCompare(b.name));
  const dots: Row[] = showAll
    ? [{ name: ".", node }, { name: "..", node }]
    : [];
  return [...dots, ...rest];
}

function renderShort(ctx: CommandContext, rows: Row[]): void {
  if (rows.length === 0) return;
  ctx.writeln(rows.map(cell).join("  "));
}

function renderLong(ctx: CommandContext, rows: Row[], withTotal: boolean): void {
  const owner = ctx.data.handle;
  let total = 0;
  let sizeW = 0;
  const sizes = rows.map((r) => {
    total += blocks(r.node.size);
    const s = String(r.node.size);
    sizeW = Math.max(sizeW, s.length);
    return s;
  });
  if (withTotal) ctx.writeln(`total ${total}`);
  rows.forEach((row, i) => {
    const links = row.node.kind === "dir" ? 2 : 1;
    const size = (sizes[i] ?? "").padStart(sizeW);
    ctx.writeln(
      `${formatMode(row.node)} ${links} ${owner} ${owner} ${size}  ` +
      `${formatDate(row.node.mtime)}  ${cell(row)}`,
    );
  });
}

export const ls: Command = {
  name: "ls",
  summary: "list directory contents",
  complete(ctx) {
    return completePath(ctx.vfs, ctx.cwd, ctx.current);
  },
  run(ctx) {
    const { flags, operands } = parseLsArgs(ctx.args);
    const longFmt = flags.has("l");
    const showAll = flags.has("a");
    const names = operands.length ? operands : ["."];

    const files: Row[] = [];
    const dirs: { name: string; node: DirNode }[] = [];
    for (const name of names) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), name));
      if (!node) {
        ctx.writeln(color(PALETTE.red, `ls: cannot access '${name}': No such file or directory`));
      } else if (node.kind === "dir") {
        dirs.push({ name, node });
      } else {
        files.push({ name, node });
      }
    }

    if (files.length) {
      if (longFmt) renderLong(ctx, files, false);
      else renderShort(ctx, files);
    }

    const headers = files.length + dirs.length > 1;
    dirs.forEach((d, i) => {
      if (headers) {
        if (files.length || i > 0) ctx.writeln("");
        ctx.writeln(`${d.name}:`);
      }
      const rows = dirRows(d.node, showAll);
      if (longFmt) renderLong(ctx, rows, true);
      else renderShort(ctx, rows);
    });
  },
};

export const cd: Command = {
  name: "cd",
  summary: "change the working directory",
  complete(ctx) {
    return completePath(ctx.vfs, ctx.cwd, ctx.current, { dirsOnly: true });
  },
  run(ctx) {
    const target = ctx.args[0];
    if (!target || target === "~") { ctx.setCwd(ctx.vfs.homePath); return; }
    const abs = ctx.vfs.resolvePath(ctx.cwd(), target);
    const node = ctx.vfs.lookup(abs);
    if (!node) {
      ctx.writeln(color(PALETTE.red, `cd: no such file or directory: ${target}`));
      return;
    }
    if (node.kind !== "dir") {
      ctx.writeln(color(PALETTE.red, `cd: not a directory: ${target}`));
      return;
    }
    ctx.setCwd(abs);
  },
};

export const open: Command = {
  name: "open",
  summary: "open a page or social link in the browser",
  complete(ctx) {
    return [
      ...completePath(ctx.vfs, ctx.cwd, ctx.current),
      ...ctx.data.socials.map((s) => s.label).filter((l) => l.startsWith(ctx.current)),
    ];
  },
  run(ctx) {
    const target = ctx.args[0] ?? "";
    const social = ctx.data.socials.find((s) => s.label === target);
    if (social) { navigate(social.url); return; }
    const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), target));
    if (node?.url) { navigate(node.url); return; }
    ctx.writeln(color(PALETTE.red, `open: cannot open '${target}'`));
  },
};

export const cat: Command = {
  name: "cat",
  summary: "show file contents",
  complete(ctx) {
    return completePath(ctx.vfs, ctx.cwd, ctx.current);
  },
  run(ctx) {
    if (ctx.args.length === 0) {
      ctx.writeln(color(PALETTE.red, "cat: missing operand"));
      return;
    }
    for (const name of ctx.args) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), name));
      if (!node) {
        ctx.writeln(color(PALETTE.red, `cat: ${name}: No such file or directory`));
      } else if (node.kind === "dir") {
        ctx.writeln(color(PALETTE.red, `cat: ${name}: Is a directory`));
      } else {
        for (const line of node.content()) ctx.writeln(line);
      }
    }
  },
};
