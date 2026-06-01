// Path-string commands. basename/dirname are pure string operations (no VFS);
// realpath resolves against the live cwd through the VFS.

import type { Command } from "../shell";
import { color, PALETTE } from "../ansi";
import { pathComplete } from "./text";

const red = (s: string): string => color(PALETTE.red, s);

export const basename: Command = {
  name: "basename",
  summary: "strip directory and suffix from a path",
  usage: "basename PATH [SUFFIX]",
  details: "Print PATH with any leading directory components removed. If SUFFIX is given and matches the end (but not the whole name), it is removed too.",
  run(ctx) {
    const p = ctx.args[0];
    const suffix = ctx.args[1];
    if (p === undefined) { ctx.errln(red("basename: missing operand")); return 1; }
    let base = p.replace(/\/+$/, "");
    if (base === "") { ctx.writeln("/"); return 0; }
    const slash = base.lastIndexOf("/");
    if (slash >= 0) base = base.slice(slash + 1);
    if (suffix && base !== suffix && base.endsWith(suffix)) base = base.slice(0, -suffix.length);
    ctx.writeln(base);
    return 0;
  },
};

export const dirname: Command = {
  name: "dirname",
  summary: "strip the last component from a path",
  usage: "dirname PATH",
  details: "Print PATH with its last component removed; print '.' when PATH has no directory part.",
  run(ctx) {
    const p = ctx.args[0];
    if (p === undefined) { ctx.errln(red("dirname: missing operand")); return 1; }
    const s = p.replace(/\/+$/, "");
    const slash = s.lastIndexOf("/");
    if (slash < 0) ctx.writeln(".");
    else if (slash === 0) ctx.writeln("/");
    else ctx.writeln(s.slice(0, slash));
    return 0;
  },
};

export const realpath: Command = {
  name: "realpath",
  summary: "resolve a path to its absolute form",
  usage: "realpath PATH...",
  details: "Print the absolute, normalized path for each operand. Fails for a path that does not exist.",
  complete: pathComplete,
  run(ctx) {
    if (ctx.args.length === 0) { ctx.errln(red("realpath: missing operand")); return 1; }
    let code = 0;
    for (const p of ctx.args) {
      const abs = ctx.vfs.resolvePath(ctx.cwd(), p);
      if (!ctx.vfs.lookup(abs)) { ctx.errln(red(`realpath: ${p}: No such file or directory`)); code = 1; continue; }
      ctx.writeln(abs);
    }
    return code;
  },
};
