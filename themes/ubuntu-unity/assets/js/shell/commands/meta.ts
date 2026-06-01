import type { Command, CommandContext } from "../shell";
import { color, PALETTE } from "../ansi";
import { writeBanner } from "../banner";

export const help: Command = {
  name: "help",
  summary: "list available commands",
  usage: "help",
  details: "List the built-in commands and a one-line summary of each. Use `man COMMAND` for a fuller description.",
  run(ctx) {
    const cmds = ctx.commands().filter((c) => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
    const width = cmds.reduce((m, c) => Math.max(m, c.name.length), 0);
    for (const c of cmds) {
      ctx.writeln(`  ${color(PALETTE.green, c.name.padEnd(width))}  ${color(PALETTE.fg, c.summary)}`);
    }
    return 0;
  },
};

export const neofetch: Command = {
  name: "neofetch",
  summary: "print the profile banner",
  run(ctx) {
    writeBanner(ctx.term, ctx.data);
    return 0;
  },
};

export const whoami: Command = {
  name: "whoami",
  summary: "print the current user",
  run(ctx) {
    ctx.writeln(ctx.data.handle);
    return 0;
  },
};

function printSocials(ctx: CommandContext): void {
  const width = ctx.data.socials.reduce((m, s) => Math.max(m, s.label.length), 0);
  for (const s of ctx.data.socials) {
    ctx.writeln(`${color(PALETTE.red, s.label.padEnd(width))}  ${color(PALETTE.blue, s.url)}`);
  }
}

export const social: Command = {
  name: "social",
  summary: "list social links",
  run(ctx) { printSocials(ctx); return 0; },
};

export const links: Command = { ...social, name: "links" };

export const date: Command = {
  name: "date",
  summary: "print the current date and time",
  run(ctx) {
    ctx.writeln(new Date().toString());
    return 0;
  },
};

export const uptime: Command = {
  name: "uptime",
  summary: "show how long the host has been up",
  run(ctx) {
    ctx.writeln(`up ${ctx.data.uptime}`);
    return 0;
  },
};

export const echo: Command = {
  name: "echo",
  summary: "print text",
  usage: "echo [-n] [STRING...]",
  details: "Write arguments to standard output, separated by spaces. -n suppresses the trailing newline.",
  run(ctx) {
    let args = ctx.args;
    let newline = true;
    while (args[0] === "-n") { newline = false; args = args.slice(1); }
    const text = args.join(" ");
    if (newline) ctx.writeln(text); else ctx.write(text);
    return 0;
  },
};

export const history: Command = {
  name: "history",
  summary: "show command history",
  run(ctx) {
    const items = ctx.history();
    const width = String(items.length).length;
    items.forEach((line, i) => {
      ctx.writeln(`  ${color(PALETTE.muted, String(i + 1).padStart(width))}  ${line}`);
    });
    return 0;
  },
};

export const clear: Command = {
  name: "clear",
  summary: "clear the terminal",
  run(ctx) {
    ctx.clear();
    return 0;
  },
};
