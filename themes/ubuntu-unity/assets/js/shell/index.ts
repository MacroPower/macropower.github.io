import { XtermTerminal } from "./terminal";
import { Shell, type ShellData } from "./shell";
import { writeBanner } from "./banner";
import { color, PALETTE } from "./ansi";
import { cat, cd, ls, open, pwd } from "./commands/fs";
import {
  clear, date, echo, help, history, links, neofetch, social, uptime, whoami,
} from "./commands/meta";
import { exit, sudo } from "./commands/eggs";
import { fls, grep, head, sort, tail, tru, wc } from "./commands/text";
import {
  alias, envCmd, exportCmd, man, setCmd, typeCmd, unalias, unset, which,
} from "./commands/builtins";

const HISTORY_KEY = "up:shell-history";

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory(items: readonly string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(-500)));
  } catch {
    // localStorage may be unavailable (private mode); history stays in-memory.
  }
}

(function (): void {
  "use strict";

  const root = document.querySelector<HTMLElement>("[data-shell]");
  if (!root) return;

  const dataEl = root.querySelector<HTMLScriptElement>("[data-shell-data]");
  const mount = root.querySelector<HTMLElement>("[data-shell-mount]");
  if (!dataEl || !mount) return;

  let data: ShellData;
  try {
    data = JSON.parse(dataEl.textContent ?? "") as ShellData;
  } catch {
    return;
  }

  const term = new XtermTerminal(mount);
  const shell = new Shell(term, data, {
    history: loadHistory(),
    persist: saveHistory,
  });
  shell.register(
    help, man,
    neofetch, whoami, pwd, ls, cd, open, cat,
    echo, grep, head, tail, wc, sort,
    alias, unalias, exportCmd, envCmd, setCmd, unset, which, typeCmd,
    social, links, date, uptime, history, clear,
    tru, fls,
    sudo, exit,
  );

  // Print the banner only after the web font has loaded so term.cols() (used
  // to size the banner's info column) reflects the real cell metrics. Falls
  // back to a timeout so a stalled font load never blocks the shell.
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    term.fit();
    writeBanner(term, data);
    term.writeln("");
    term.writeln(color(PALETTE.muted, "Type 'help' for a list of commands."));
    term.writeln("");
    shell.start();
    root.setAttribute("data-shell-ready", "");
  };

  if (document.fonts?.ready) {
    void document.fonts.ready.then(start);
    setTimeout(start, 1000);
  } else {
    start();
  }
})();
