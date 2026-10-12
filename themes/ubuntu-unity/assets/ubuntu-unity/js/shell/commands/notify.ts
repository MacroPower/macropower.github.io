// notify-send — the terminal's bridge to the desktop's notify-osd bubbles.
// The shell is a separate bundle from app.ts and cannot import notify.ts, so
// the bubble crosses over as a window CustomEvent. The literal "up:notify"
// must stay in sync with NOTIFY_EVENT in ../../notify.ts — the same
// duplicated-by-design contract as "up:page-window-state" (importing the
// module would inline the app bundle's side effects here). The dispatch is
// fenced behind a typeof-window guard (the nav.ts isolation rule) so the
// command stays runnable — and testable — under headless Node, where firing
// at a daemon that isn't there is simply a no-op, much like a real notify-send
// pointed at a missing DBus session.

import type { Command } from "../shell";
import { color, PALETTE } from "../ansi";

const red = (s: string): string => color(PALETTE.red, s);

function dispatchNotify(detail: { summary: string; body?: string; icon?: string; timeoutMs?: number }): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("up:notify", { detail }));
}

const URGENCIES = new Set(["low", "normal", "critical"]);

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
    const args = ctx.args;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (optionsDone) { operands.push(a); continue; }
      if (a === "--") { optionsDone = true; continue; }
      const takeValue = (flag: string): string | undefined => {
        const eq = a.indexOf("=");
        if (a.startsWith("--") && eq !== -1) return a.slice(eq + 1);
        const v = args[++i];
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
    if (operands.length === 0) {
      ctx.errln(red("notify-send: no summary specified"));
      return 1;
    }
    if (operands.length > 2) {
      ctx.errln(red("notify-send: invalid number of options"));
      return 1;
    }
    dispatchNotify({ summary: operands[0], body: operands[1], icon, timeoutMs });
    return 0;
  },
};
