// Shell builtins for variables, aliases, and introspection.

import type { Command, CompleteContext } from "../shell";
import { bold, color, PALETTE } from "../ansi";

const red = (s: string): string => color(PALETTE.red, s);

function completeNames(ctx: CompleteContext): string[] {
  return [...ctx.commandNames, ...ctx.aliasNames].filter((n) => n.startsWith(ctx.current));
}

function formatAlias(name: string, value: string): string {
  return `alias ${name}='${value}'`;
}

export const alias: Command = {
  name: "alias",
  builtin: true,
  summary: "define or display command aliases",
  usage: "alias [name[=value] ...]",
  details: "With no arguments, list defined aliases. `alias name=value` defines one; `alias name` prints a single definition.",
  run(ctx) {
    if (ctx.args.length === 0) {
      for (const name of [...ctx.aliases.keys()].sort()) {
        ctx.writeln(formatAlias(name, ctx.aliases.get(name) ?? ""));
      }
      return 0;
    }
    let code = 0;
    for (const a of ctx.args) {
      const eq = a.indexOf("=");
      if (eq === -1) {
        const value = ctx.aliases.get(a);
        if (value === undefined) { ctx.errln(red(`alias: ${a}: not found`)); code = 1; }
        else ctx.writeln(formatAlias(a, value));
      } else {
        ctx.aliases.set(a.slice(0, eq), a.slice(eq + 1));
      }
    }
    return code;
  },
};

export const unalias: Command = {
  name: "unalias",
  builtin: true,
  summary: "remove command aliases",
  usage: "unalias name ...",
  run(ctx) {
    if (ctx.args.length === 0) { ctx.errln(red("unalias: usage: unalias name [name ...]")); return 2; }
    let code = 0;
    for (const a of ctx.args) {
      if (!ctx.aliases.delete(a)) { ctx.errln(red(`unalias: ${a}: not found`)); code = 1; }
    }
    return code;
  },
};

export const exportCmd: Command = {
  name: "export",
  builtin: true,
  summary: "set environment variables",
  usage: "export [NAME[=value] ...]",
  details: "Mark variables for export to the environment of subsequent commands. With no arguments, list exported variables.",
  run(ctx) {
    if (ctx.args.length === 0) {
      for (const [k, v] of ctx.env.exports()) ctx.writeln(`declare -x ${k}="${v}"`);
      return 0;
    }
    for (const a of ctx.args) {
      const eq = a.indexOf("=");
      if (eq === -1) ctx.env.markExported(a);
      else ctx.env.set(a.slice(0, eq), a.slice(eq + 1), { export: true });
    }
    return 0;
  },
};

export const envCmd: Command = {
  name: "env",
  summary: "print the exported environment",
  run(ctx) {
    for (const [k, v] of ctx.env.exports()) ctx.writeln(`${k}=${v}`);
    return 0;
  },
};

export const setCmd: Command = {
  name: "set",
  builtin: true,
  summary: "print all shell variables",
  run(ctx) {
    for (const [k, v] of ctx.env.all()) ctx.writeln(`${k}=${v}`);
    return 0;
  },
};

export const unset: Command = {
  name: "unset",
  builtin: true,
  summary: "remove shell variables",
  usage: "unset NAME ...",
  run(ctx) {
    for (const a of ctx.args) ctx.env.unset(a);
    return 0;
  },
};

export const which: Command = {
  name: "which",
  summary: "locate a command on PATH",
  usage: "which name ...",
  details: "Search $PATH for each name and print the full path of the executable that would run. Like the external utility, it sees only programs on PATH -- not aliases, functions, or shell builtins -- and stays silent (exit 1) for names it cannot find.",
  complete: completeNames,
  run(ctx) {
    const path = ctx.env.get("PATH") ?? "";
    let code = 0;
    for (const a of ctx.args) {
      const resolved = ctx.vfs.resolveCommand(a, ctx.cwd(), path);
      if (resolved) ctx.writeln(resolved);
      else code = 1;
    }
    return code;
  },
};

export const typeCmd: Command = {
  name: "type",
  summary: "describe how a name would be interpreted",
  usage: "type name ...",
  builtin: true,
  complete: completeNames,
  run(ctx) {
    const path = ctx.env.get("PATH") ?? "";
    let code = 0;
    for (const a of ctx.args) {
      const alias = ctx.aliases.get(a);
      if (alias !== undefined) { ctx.writeln(`${a} is aliased to \`${alias}'`); continue; }
      if (ctx.commands().find((c) => c.name === a)?.builtin) {
        ctx.writeln(`${a} is a shell builtin`);
        continue;
      }
      const resolved = ctx.vfs.resolveCommand(a, ctx.cwd(), path);
      if (resolved) { ctx.writeln(`${a} is ${resolved}`); continue; }
      ctx.errln(`bash: type: ${a}: not found`);
      code = 1;
    }
    return code;
  },
};

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

export const man: Command = {
  name: "man",
  summary: "display the manual for a command",
  usage: "man command",
  complete: completeNames,
  run(ctx) {
    const target = ctx.args[0];
    if (!target) { ctx.errln("What manual page do you want?"); return 1; }
    const cmd = ctx.commands().find((c) => c.name === target);
    if (!cmd) { ctx.errln(red(`No manual entry for ${target}`)); return 1; }
    ctx.writeln(bold("NAME"));
    ctx.writeln(`    ${cmd.name} - ${cmd.summary}`);
    ctx.writeln("");
    ctx.writeln(bold("SYNOPSIS"));
    ctx.writeln(`    ${cmd.usage ?? cmd.name}`);
    ctx.writeln("");
    ctx.writeln(bold("DESCRIPTION"));
    for (const line of wrap(cmd.details ?? cmd.summary, 68)) ctx.writeln(`    ${line}`);
    return 0;
  },
};
