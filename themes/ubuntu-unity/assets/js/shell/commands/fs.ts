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
  usage: "pwd",
  run(ctx) {
    ctx.writeln(ctx.cwd());
    return 0;
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
  // One entry per line when piped/redirected (like real ls to a non-tty), so
  // downstream filters see each name on its own line; columns only on a tty.
  if (!ctx.isTTY) {
    for (const row of rows) ctx.writeln(cell(row));
    return;
  }
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
  usage: "ls [-la] [FILE...]",
  details: "List information about files (the current directory by default). -l uses a long listing format; -a shows entries starting with a dot.",
  complete(ctx) {
    return completePath(ctx.vfs, ctx.cwd, ctx.current);
  },
  run(ctx) {
    const { flags, operands } = parseLsArgs(ctx.args);
    const longFmt = flags.has("l");
    const showAll = flags.has("a");
    const names = operands.length ? operands : ["."];

    let code = 0;
    const files: Row[] = [];
    const dirs: { name: string; node: DirNode }[] = [];
    for (const name of names) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), name));
      if (!node) {
        ctx.errln(color(PALETTE.red, `ls: cannot access '${name}': No such file or directory`));
        code = 2;
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
    return code;
  },
};

export const cd: Command = {
  name: "cd",
  summary: "change the working directory",
  usage: "cd [DIR]",
  details: "Change the shell working directory. With no argument, change to $HOME; `cd -` returns to the previous directory ($OLDPWD).",
  complete(ctx) {
    return completePath(ctx.vfs, ctx.cwd, ctx.current, { dirsOnly: true });
  },
  run(ctx) {
    const target = ctx.args[0];
    if (!target || target === "~") { ctx.setCwd(ctx.vfs.homePath); return 0; }
    if (target === "-") {
      const prev = ctx.env.get("OLDPWD");
      if (!prev) { ctx.errln(color(PALETTE.red, "bash: cd: OLDPWD not set")); return 1; }
      ctx.setCwd(prev);
      ctx.writeln(prev);
      return 0;
    }
    const abs = ctx.vfs.resolvePath(ctx.cwd(), target);
    const node = ctx.vfs.lookup(abs);
    if (!node) {
      ctx.errln(color(PALETTE.red, `bash: cd: ${target}: No such file or directory`));
      return 1;
    }
    if (node.kind !== "dir") {
      ctx.errln(color(PALETTE.red, `bash: cd: ${target}: Not a directory`));
      return 1;
    }
    ctx.setCwd(abs);
    return 0;
  },
};

export const open: Command = {
  name: "open",
  summary: "open a page or social link in the browser",
  usage: "open TARGET",
  details: "Navigate the browser to a file's underlying page (posts, pages) or to a named social link.",
  complete(ctx) {
    return [
      ...completePath(ctx.vfs, ctx.cwd, ctx.current),
      ...ctx.data.socials.map((s) => s.label).filter((l) => l.startsWith(ctx.current)),
    ];
  },
  run(ctx) {
    const target = ctx.args[0] ?? "";
    const social = ctx.data.socials.find((s) => s.label === target);
    if (social) { navigate(social.url); return 0; }
    const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), target));
    if (node?.url) { navigate(node.url); return 0; }
    ctx.errln(color(PALETTE.red, `open: cannot open '${target}'`));
    return 1;
  },
};

export const cat: Command = {
  name: "cat",
  summary: "show file contents",
  usage: "cat [FILE...]",
  details: "Concatenate files to the terminal. With no file arguments, copy standard input (e.g. the left side of a pipe).",
  complete(ctx) {
    return completePath(ctx.vfs, ctx.cwd, ctx.current);
  },
  run(ctx) {
    if (ctx.args.length === 0) {
      for (const line of ctx.stdin) ctx.writeln(line);
      return 0;
    }
    let code = 0;
    for (const name of ctx.args) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), name));
      if (!node) {
        ctx.errln(color(PALETTE.red, `cat: ${name}: No such file or directory`));
        code = 1;
      } else if (node.kind === "dir") {
        ctx.errln(color(PALETTE.red, `cat: ${name}: Is a directory`));
        code = 1;
      } else {
        for (const line of node.content()) ctx.writeln(line);
      }
    }
    return code;
  },
};
