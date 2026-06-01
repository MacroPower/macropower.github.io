// File-mutation commands -- thin wrappers over the VFS session write API
// (vfs.ts). Each wraps a bash-style failure reason (e.g. "Is a directory") in
// its own conventional message prefix (`mkdir: cannot create directory '...'`,
// `rm: cannot remove '...'`, ...) and routes it through ctx.errln; they reuse
// completePath for tab completion. All are external programs (a /usr/bin stub
// is installed), so the `builtin` flag stays off.

import type { Command } from "../shell";
import { color, PALETTE } from "../ansi";
import { completePath } from "../vfs";
import { pathComplete, splitFlags } from "./text";

const red = (s: string): string => color(PALETTE.red, s);

export const mkdir: Command = {
  name: "mkdir",
  summary: "make directories",
  usage: "mkdir [-p] DIR...",
  details: "Create each named directory. -p makes parent directories as needed and does not error if the target already exists.",
  complete: (ctx) => completePath(ctx.vfs, ctx.cwd, ctx.current, { dirsOnly: true }),
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    if (operands.length === 0) { ctx.errln(red("mkdir: missing operand")); return 1; }
    const parents = flags.has("p");
    let code = 0;
    for (const op of operands) {
      const err = ctx.vfs.mkdir(ctx.vfs.resolvePath(ctx.cwd(), op), { parents });
      if (err) { ctx.errln(red(`mkdir: cannot create directory '${op}': ${err}`)); code = 1; }
    }
    return code;
  },
};

export const rmdir: Command = {
  name: "rmdir",
  summary: "remove empty directories",
  usage: "rmdir DIR...",
  details: "Remove each directory, which must be empty.",
  complete: (ctx) => completePath(ctx.vfs, ctx.cwd, ctx.current, { dirsOnly: true }),
  run(ctx) {
    if (ctx.args.length === 0) { ctx.errln(red("rmdir: missing operand")); return 1; }
    let code = 0;
    for (const op of ctx.args) {
      const err = ctx.vfs.removePath(ctx.vfs.resolvePath(ctx.cwd(), op), { dirOnly: true });
      if (err) { ctx.errln(red(`rmdir: failed to remove '${op}': ${err}`)); code = 1; }
    }
    return code;
  },
};

export const rm: Command = {
  name: "rm",
  summary: "remove files and directories",
  usage: "rm [-rf] FILE...",
  details: "Remove files. -r (or -R) removes directories and their contents recursively; -f ignores missing operands and never reports an error.",
  complete: pathComplete,
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const recursive = flags.has("r") || flags.has("R");
    const force = flags.has("f");
    if (operands.length === 0) {
      if (force) return 0;
      ctx.errln(red("rm: missing operand"));
      return 1;
    }
    let code = 0;
    for (const op of operands) {
      const err = ctx.vfs.removePath(ctx.vfs.resolvePath(ctx.cwd(), op), { recursive });
      if (err) {
        if (force && err === "No such file or directory") continue;
        ctx.errln(red(`rm: cannot remove '${op}': ${err}`));
        code = 1;
      }
    }
    return code;
  },
};

export const touch: Command = {
  name: "touch",
  summary: "create empty files",
  usage: "touch FILE...",
  details: "Create each FILE that does not exist (empty). Existing files are left unchanged -- timestamps are static in this environment, so there is nothing to bump.",
  complete: pathComplete,
  run(ctx) {
    if (ctx.args.length === 0) { ctx.errln(red("touch: missing file operand")); return 1; }
    let code = 0;
    for (const op of ctx.args) {
      const err = ctx.vfs.touch(ctx.vfs.resolvePath(ctx.cwd(), op));
      if (err) { ctx.errln(red(`touch: cannot touch '${op}': ${err}`)); code = 1; }
    }
    return code;
  },
};

export const cp: Command = {
  name: "cp",
  summary: "copy files and directories",
  usage: "cp [-r] SOURCE... DEST",
  details: "Copy SOURCE to DEST. -r (or -R) copies directories recursively. With several sources, DEST must be an existing directory.",
  complete: pathComplete,
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const recursive = flags.has("r") || flags.has("R");
    if (operands.length < 2) { ctx.errln(red("cp: missing destination file operand")); return 1; }
    const dest = operands[operands.length - 1] as string;
    const srcs = operands.slice(0, -1);
    const destAbs = ctx.vfs.resolvePath(ctx.cwd(), dest);
    const destNode = ctx.vfs.lookup(destAbs);
    if (srcs.length > 1 && destNode?.kind !== "dir") {
      ctx.errln(red(`cp: target '${dest}' is not a directory`));
      return 1;
    }
    let code = 0;
    for (const src of srcs) {
      const err = ctx.vfs.copy(ctx.vfs.resolvePath(ctx.cwd(), src), destAbs, { recursive });
      if (err === "omitting directory") {
        ctx.errln(red(`cp: -r not specified; omitting directory '${src}'`));
        code = 1;
      } else if (err) {
        ctx.errln(red(`cp: cannot stat '${src}': ${err}`));
        code = 1;
      }
    }
    return code;
  },
};

export const mv: Command = {
  name: "mv",
  summary: "move or rename files",
  usage: "mv SOURCE... DEST",
  details: "Rename SOURCE to DEST, or move sources into an existing DEST directory.",
  complete: pathComplete,
  run(ctx) {
    const { operands } = splitFlags(ctx.args);
    if (operands.length < 2) { ctx.errln(red("mv: missing destination file operand")); return 1; }
    const dest = operands[operands.length - 1] as string;
    const srcs = operands.slice(0, -1);
    const destAbs = ctx.vfs.resolvePath(ctx.cwd(), dest);
    const destNode = ctx.vfs.lookup(destAbs);
    if (srcs.length > 1 && destNode?.kind !== "dir") {
      ctx.errln(red(`mv: target '${dest}' is not a directory`));
      return 1;
    }
    let code = 0;
    for (const src of srcs) {
      const err = ctx.vfs.move(ctx.vfs.resolvePath(ctx.cwd(), src), destAbs);
      if (err) { ctx.errln(red(`mv: cannot move '${src}': ${err}`)); code = 1; }
    }
    return code;
  },
};
