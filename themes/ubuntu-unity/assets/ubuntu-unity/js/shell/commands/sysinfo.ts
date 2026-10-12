// System-identity commands. Most read static facts or the ShellData island;
// `cal` is the one that consults a real Date (like `date`), so its output is
// nondeterministic and is only shape-checked in tests.

import type { Command } from "../shell";
import { splitFlags } from "./text";

const KERNEL = "Linux";
const RELEASE = "6.8.0-generic";
const MACHINE = "x86_64";

export const id: Command = {
  name: "id",
  summary: "print user and group identity",
  usage: "id",
  run(ctx) {
    const u = ctx.data.handle;
    ctx.writeln(`uid=1000(${u}) gid=1000(${u}) groups=1000(${u}),27(sudo)`);
    return 0;
  },
};

export const groups: Command = {
  name: "groups",
  summary: "print the groups a user belongs to",
  usage: "groups",
  run(ctx) {
    ctx.writeln(`${ctx.data.handle} sudo`);
    return 0;
  },
};

export const uname: Command = {
  name: "uname",
  summary: "print system information",
  usage: "uname [-asrmn]",
  details: "Print system information. -s kernel name (default), -n network node name, -r kernel release, -m machine, -a prints everything.",
  run(ctx) {
    const { flags } = splitFlags(ctx.args);
    const node = ctx.data.host;
    if (flags.has("a")) { ctx.writeln(`${KERNEL} ${node} ${RELEASE} #1 SMP ${MACHINE} GNU/Linux`); return 0; }
    const parts: string[] = [];
    if (flags.has("s")) parts.push(KERNEL);
    if (flags.has("n")) parts.push(node);
    if (flags.has("r")) parts.push(RELEASE);
    if (flags.has("m")) parts.push(MACHINE);
    ctx.writeln(parts.length ? parts.join(" ") : KERNEL);
    return 0;
  },
};

export const hostname: Command = {
  name: "hostname",
  summary: "print the system hostname",
  usage: "hostname",
  run(ctx) {
    ctx.writeln(ctx.data.host);
    return 0;
  },
};

export const arch: Command = {
  name: "arch",
  summary: "print the machine architecture",
  usage: "arch",
  run(ctx) {
    ctx.writeln(MACHINE);
    return 0;
  },
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const cal: Command = {
  name: "cal",
  summary: "show a calendar for the current month",
  usage: "cal",
  details: "Display a calendar grid for the current month, with the present-day reading taken from the host clock.",
  run(ctx) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const title = `${MONTH_NAMES[month]} ${year}`;
    const pad = Math.max(0, Math.floor((20 - title.length) / 2));
    ctx.writeln(" ".repeat(pad) + title);
    ctx.writeln("Su Mo Tu We Th Fr Sa");
    const cells: string[] = [];
    for (let i = 0; i < firstDay; i += 1) cells.push("  ");
    for (let d = 1; d <= daysInMonth; d += 1) cells.push(String(d).padStart(2));
    for (let i = 0; i < cells.length; i += 7) {
      ctx.writeln(cells.slice(i, i + 7).join(" ").replace(/\s+$/, ""));
    }
    return 0;
  },
};
