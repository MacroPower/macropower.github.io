import type { Command, CommandContext } from "../shell";
import { color, PALETTE } from "../ansi";
import { writeBanner } from "../banner";
import { decodeEscape } from "./escapes";

export const help: Command = {
  name: "help",
  builtin: true,
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

// Interpret the backslash escapes that `echo -e` honors (the bash builtin set).
// \c stops output entirely (signaled via the returned flag); every other escape
// shares printf's decoder.
function echoEscapes(s: string): { text: string; stop: boolean } {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "\\") { out += s[i]; i += 1; continue; }
    if (s[i + 1] === "c") return { text: out, stop: true };
    const e = decodeEscape(s, i);
    out += e.text;
    i += e.len;
  }
  return { text: out, stop: false };
}

export const echo: Command = {
  name: "echo",
  builtin: true,
  summary: "print text",
  usage: "echo [-neE] [STRING...]",
  details: "Write arguments to standard output, separated by spaces. -n suppresses the trailing newline; -e enables backslash escapes (\\n \\t \\\\ \\a \\r \\0NNN), -E (default) disables them.",
  run(ctx) {
    let args = ctx.args;
    let newline = true;
    let escapes = false;
    // Leading flag tokens are exactly -, then one or more of n/e/E; the first
    // token with any other char (or a non-flag) stops parsing and is an operand.
    while (args.length) {
      const a = args[0] ?? "";
      if (a.length < 2 || a[0] !== "-" || ![...a.slice(1)].every((c) => "neE".includes(c))) break;
      for (const c of a.slice(1)) {
        if (c === "n") newline = false;
        else if (c === "e") escapes = true;
        else escapes = false;
      }
      args = args.slice(1);
    }
    let text = args.join(" ");
    if (escapes) {
      const r = echoEscapes(text);
      text = r.text;
      if (r.stop) newline = false;
    }
    if (newline) ctx.writeln(text); else ctx.write(text);
    return 0;
  },
};

export const history: Command = {
  name: "history",
  builtin: true,
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
