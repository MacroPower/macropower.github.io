// Pagers, for muscle memory. With no alternate screen or raw-mode scrolling
// available here, less/more behave like cat: dump the file (keeping its color)
// or copy standard input.

import type { Command } from "../shell";
import { color, PALETTE } from "../ansi";
import { pathComplete } from "./text";

const red = (s: string): string => color(PALETTE.red, s);

export const less: Command = {
  name: "less",
  summary: "page through a file",
  usage: "less [FILE...]",
  details: "Show files a screen at a time. This terminal has no alternate screen or scrolling, so it simply prints the contents like cat.",
  complete: pathComplete,
  run(ctx) {
    if (ctx.args.length === 0) {
      for (const l of ctx.stdin) ctx.writeln(l);
      return 0;
    }
    let code = 0;
    for (const name of ctx.args) {
      const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), name));
      if (!node) { ctx.errln(red(`less: ${name}: No such file or directory`)); code = 1; }
      else if (node.kind === "dir") { ctx.errln(red(`less: ${name}: Is a directory`)); code = 1; }
      else for (const l of node.content()) ctx.writeln(l);
    }
    return code;
  },
};

export const more: Command = { ...less, name: "more", summary: "page through a file (like less)" };
