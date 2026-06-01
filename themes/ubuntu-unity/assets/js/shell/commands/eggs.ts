import type { Command } from "../shell";

export const sudo: Command = {
  name: "sudo",
  summary: "execute a command as another user",
  hidden: true,
  run(ctx) {
    ctx.writeln(`${ctx.data.handle} is not in the sudoers file. This incident will be reported.`);
    return 1;
  },
};

export const exit: Command = {
  name: "exit",
  summary: "close the session",
  hidden: true,
  run(ctx) {
    ctx.writeln("logout");
    ctx.writeln(`Connection to ${ctx.data.host} closed.`);
    return 0;
  },
};
