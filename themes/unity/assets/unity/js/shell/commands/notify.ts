// notify-send, the terminal's bridge to the desktop's notify-osd bubbles.
// The shell is a separate bundle from app.ts and cannot import notify.ts, so
// the bubble crosses over as a NOTIFY_EVENT window event. A typeof-window
// guard fences the dispatch, as the nav.ts isolation rule asks, so the
// command still runs under headless Node and tests can run it. There, firing
// at a daemon that is not there does nothing, much like a real notify-send
// pointed at a missing DBus session.

import type { Command } from "../shell";
import { color, PALETTE } from "../ansi";
import { emitWindow, NOTIFY_EVENT, type UPNotifyDetail } from "../../events";

const red = (s: string): string => color(PALETTE.red, s);

function dispatchNotify(detail: UPNotifyDetail): void {
  if (typeof window === "undefined") return;
  emitWindow(NOTIFY_EVENT, detail);
}

const URGENCIES: ReadonlySet<string> = new Set(["low", "normal", "critical"]);

export const notifySend: Command = {
  name: "notify-send",
  summary: "send a desktop notification",
  usage: "notify-send [-u LEVEL] [-t TIME] [-i ICON] SUMMARY [BODY]",
  details:
    "Raise a notify-osd bubble on the desktop. SUMMARY is the bubble title and the optional BODY its second line. -i/--icon names a themed icon (info, warning, question, success, volume, network, battery, heart, lock, terminal, music; freedesktop names like dialog-information work too). -t/--expire-time sets the display time in milliseconds (clamped to 1-20s). -u/--urgency accepts low, normal, or critical, and is accepted for compatibility. The bubbles are passive: they take no clicks, and pointing at one turns it translucent so you can read what's underneath.",
  run(ctx) {
    const operands: string[] = [];
    let icon: string | undefined;
    let timeoutMs: number | undefined;
    let optionsDone = false;
    const args = ctx.args.values();
    for (const a of args) {
      if (optionsDone) { operands.push(a); continue; }
      if (a === "--") { optionsDone = true; continue; }
      const takeValue = (flag: string): string | undefined => {
        const eq = a.indexOf("=");
        if (a.startsWith("--") && eq !== -1) return a.slice(eq + 1);
        const v = args.next().value;
        if (v === undefined) ctx.errln(red(`notify-send: option '${flag}' requires a value`));
        return v;
      };
      if (a === "-i" || a === "--icon" || a.startsWith("--icon=")) {
        icon = takeValue("--icon");
        if (icon === undefined) return 1;
      } else if (a === "-t" || a === "--expire-time" || a.startsWith("--expire-time=")) {
        const v = takeValue("--expire-time");
        if (v === undefined) return 1;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          ctx.errln(red(`notify-send: invalid expire time '${v}'`));
          return 1;
        }
        timeoutMs = n;
      } else if (a === "-u" || a === "--urgency" || a.startsWith("--urgency=")) {
        const v = takeValue("--urgency");
        if (v === undefined) return 1;
        if (!URGENCIES.has(v)) {
          ctx.errln(red(`notify-send: unknown urgency ${v} specified, known urgency levels: low, normal, critical`));
          return 1;
        }
      } else if (a.startsWith("-") && a !== "-") {
        ctx.errln(red(`notify-send: unknown option ${a}`));
        return 1;
      } else {
        operands.push(a);
      }
    }
    const [summary, body, ...extra] = operands;
    if (summary === undefined) {
      ctx.errln(red("notify-send: no summary specified"));
      return 1;
    }
    if (extra.length) {
      ctx.errln(red("notify-send: invalid number of options"));
      return 1;
    }
    dispatchNotify({ summary, body, icon, timeoutMs });
    return 0;
  },
};
