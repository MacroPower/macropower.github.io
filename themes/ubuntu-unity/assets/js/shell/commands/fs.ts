import type { Command } from "../shell";
import { color, PALETTE } from "../ansi";
import { findPage, navigate, PAGE_ENTRIES } from "./nav";

function expandCwd(cwd: string, handle: string): string {
  const home = `/home/${handle}`;
  if (cwd === "~") return home;
  if (cwd.startsWith("~/")) return `${home}/${cwd.slice(2)}`;
  return cwd;
}

function parentOf(cwd: string): string {
  if (cwd === "~") return "/home";
  const parts = cwd.replace(/\/+$/, "").split("/");
  parts.pop();
  const next = parts.join("/");
  return next || "/";
}

export const pwd: Command = {
  name: "pwd",
  summary: "print the current directory",
  run(ctx) {
    ctx.writeln(expandCwd(ctx.cwd(), ctx.data.handle));
  },
};

export const ls: Command = {
  name: "ls",
  summary: "list directory contents",
  run(ctx) {
    const cells = PAGE_ENTRIES.map((e) =>
      e.isDir ? color(PALETTE.blue, `${e.name}/`) : color(PALETTE.fg, e.name),
    );
    ctx.writeln(cells.join("  "));
  },
};

export const cd: Command = {
  name: "cd",
  summary: "change directory (navigates to site pages)",
  complete(ctx) {
    return PAGE_ENTRIES
      .filter((e) => e.isDir && e.name.startsWith(ctx.current))
      .map((e) => e.name);
  },
  run(ctx) {
    const target = ctx.args[0];
    if (!target || target === "~") { ctx.setCwd("~"); return; }
    if (target === "..") { ctx.setCwd(parentOf(ctx.cwd())); return; }
    if (target === "/") { ctx.setCwd("/"); return; }
    const page = findPage(target);
    if (page?.isDir) { navigate(page.path); return; }
    ctx.writeln(color(PALETTE.red, `cd: no such file or directory: ${target}`));
  },
};

export const open: Command = {
  name: "open",
  summary: "open a page or social link",
  complete(ctx) {
    const names = [
      ...PAGE_ENTRIES.map((e) => e.name),
      ...ctx.data.socials.map((s) => s.label),
    ];
    return names.filter((n) => n.startsWith(ctx.current));
  },
  run(ctx) {
    const target = ctx.args[0] ?? "";
    const page = findPage(target);
    if (page) { navigate(page.path); return; }
    const social = ctx.data.socials.find((s) => s.label === target);
    if (social) { navigate(social.url); return; }
    ctx.writeln(color(PALETTE.red, `open: cannot open '${target}'`));
  },
};

function infoRow(label: string, value: string): string {
  return `${color(PALETTE.red, label.padEnd(7))}${color(PALETTE.fg, value)}`;
}

export const cat: Command = {
  name: "cat",
  summary: "show page contents",
  complete(ctx) {
    return ["cv", "about", "social"].filter((n) => n.startsWith(ctx.current));
  },
  run(ctx) {
    const target = ctx.args[0] ?? "about";
    const { data } = ctx;
    switch (target) {
      case "cv":
        ctx.writeln(color(PALETTE.fg, data.title));
        ctx.writeln(`${color(PALETTE.red, "CV: ")}${color(PALETTE.blue, `https://${data.host}/cv/`)}`);
        return;
      case "about":
        ctx.writeln(infoRow("name", data.name));
        ctx.writeln(infoRow("title", data.title));
        ctx.writeln(infoRow("uptime", data.uptime));
        return;
      case "social":
        for (const s of data.socials) {
          ctx.writeln(`${color(PALETTE.red, s.label.padEnd(12))}${color(PALETTE.blue, s.url)}`);
        }
        return;
      default:
        ctx.writeln(color(PALETTE.red, `cat: ${target}: No such file or directory`));
    }
  },
};
