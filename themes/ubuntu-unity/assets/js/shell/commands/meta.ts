import type { Command, CommandContext } from "../shell";
import { color, PALETTE } from "../ansi";
import { writeBanner } from "../banner";
import { stripControls } from "../readline";

export const help: Command = {
  name: "help",
  summary: "list available commands",
  run(ctx) {
    const cmds = ctx.commands().filter((c) => !c.hidden).sort((a, b) => a.name.localeCompare(b.name));
    const width = cmds.reduce((m, c) => Math.max(m, c.name.length), 0);
    for (const c of cmds) {
      ctx.writeln(`  ${color(PALETTE.green, c.name.padEnd(width))}  ${color(PALETTE.fg, c.summary)}`);
    }
  },
};

export const neofetch: Command = {
  name: "neofetch",
  summary: "print the profile banner",
  run(ctx) {
    writeBanner(ctx.term, ctx.data);
  },
};

export const whoami: Command = {
  name: "whoami",
  summary: "print the current user",
  run(ctx) {
    ctx.writeln(ctx.data.handle);
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
  run(ctx) { printSocials(ctx); },
};

export const links: Command = { ...social, name: "links" };

export const date: Command = {
  name: "date",
  summary: "print the current date and time",
  run(ctx) {
    ctx.writeln(new Date().toString());
  },
};

export const uptime: Command = {
  name: "uptime",
  summary: "show how long the host has been up",
  run(ctx) {
    ctx.writeln(`up ${ctx.data.uptime}`);
  },
};

export const echo: Command = {
  name: "echo",
  summary: "print text",
  run(ctx) {
    ctx.writeln(stripControls(ctx.raw, { keepTab: true }));
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
  },
};

export const clear: Command = {
  name: "clear",
  summary: "clear the terminal",
  run(ctx) {
    ctx.clear();
  },
};
