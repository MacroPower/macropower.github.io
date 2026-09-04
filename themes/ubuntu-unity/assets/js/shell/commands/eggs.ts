import type { Command } from "../shell";
import { navigate } from "./nav";

export const sudo: Command = {
  name: "sudo",
  summary: "execute a command as another user",
  hidden: true,
  run(ctx) {
    ctx.writeln(`${ctx.data.handle} is not in the sudoers file. This incident will be reported.`);
    return 1;
  },
};

// Launches the site's solitaire page when one exists (a top-level page
// whose slug is "solitaire"); hidden so it ships no /usr/bin stub on
// sites without the game.
export const solitaire: Command = {
  name: "solitaire",
  summary: "deal a game of klondike",
  hidden: true,
  run(ctx) {
    const page = ctx.data.pages.find((p) => p.slug === "solitaire");
    if (!page) {
      ctx.errln("solitaire: no deck installed");
      return 1;
    }
    ctx.writeln("Shuffling...");
    navigate(page.url);
    return 0;
  },
};

export const exit: Command = {
  name: "exit",
  summary: "close the session",
  builtin: true,
  hidden: true,
  run(ctx) {
    ctx.writeln("logout");
    ctx.writeln(`Connection to ${ctx.data.host} closed.`);
    // End the read loop: in production the host disposes the terminal and
    // shows the reconnect overlay (index.ts); headless shells keep prompting.
    ctx.requestExit();
    return 0;
  },
};
