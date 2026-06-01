// The full command set, in one place so the production entrypoint (index.ts)
// and the headless testkit register the same commands -- new commands are
// tested automatically. Kept apart from index.ts because that module runs a
// DOM bootstrap IIFE at import time, which has no place under Node.

import type { Command, Shell } from "../shell";
import { cat, cd, ls, open, pwd } from "./fs";
import {
  clear, date, echo, help, history, links, neofetch, social, uptime, whoami,
} from "./meta";
import { exit, sudo } from "./eggs";
import {
  cut, fls, grep, head, nl, rev, seq, sort, tac, tail, tee, tr, tru, uniq, wc,
} from "./text";
import { cp, mkdir, mv, rm, rmdir, touch } from "./fsmod";
import { basename, dirname, realpath } from "./path";
import { df, du, file, find, stat, tree } from "./find";
import { arch, cal, groups, hostname, id, uname } from "./sysinfo";
import { less, more } from "./pager";
import {
  alias, envCmd, exportCmd, man, setCmd, typeCmd, unalias, unset, which,
} from "./builtins";
import { colon, printf, test, testBracket } from "./posix";

export const ALL_COMMANDS: Command[] = [
  help, man,
  neofetch, whoami, pwd, ls, cd, open, cat,
  echo, grep, head, tail, wc, sort,
  cut, tr, uniq, rev, tac, nl, seq, tee,
  mkdir, rmdir, rm, touch, cp, mv,
  basename, dirname, realpath,
  find, tree, du, stat, df, file,
  id, groups, uname, hostname, arch, cal,
  less, more,
  alias, unalias, exportCmd, envCmd, setCmd, unset, which, typeCmd,
  social, links, date, uptime, history, clear,
  tru, fls,
  colon, test, testBracket, printf,
  sudo, exit,
];

export function registerAll(shell: Shell): void {
  shell.register(...ALL_COMMANDS);
}
