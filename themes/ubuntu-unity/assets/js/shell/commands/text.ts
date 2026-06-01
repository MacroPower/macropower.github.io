// Text-filter commands. Each reads its file operands, or standard input (the
// left side of a pipe) when no files are given, mirroring the real utilities.

import type { Command, CommandContext } from "../shell";
import { color, PALETTE, stripAnsi } from "../ansi";
import { completePath } from "../vfs";

const red = (s: string): string => color(PALETTE.red, s);

// Resolve the input lines for a filter: file operands (ANSI-stripped) if any,
// otherwise the piped stdin. Missing/dir operands print an error and set code.
function inputLines(
  ctx: CommandContext,
  cmd: string,
  files: string[],
): { lines: string[]; code: number } {
  if (files.length === 0) return { lines: ctx.stdin, code: 0 };
  const lines: string[] = [];
  let code = 0;
  for (const f of files) {
    const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), f));
    if (!node) { ctx.writeln(red(`${cmd}: ${f}: No such file or directory`)); code = 1; continue; }
    if (node.kind === "dir") { ctx.writeln(red(`${cmd}: ${f}: Is a directory`)); code = 1; continue; }
    for (const l of node.content()) lines.push(stripAnsi(l));
  }
  return { lines, code };
}

function splitFlags(args: string[]): { flags: Set<string>; operands: string[] } {
  const flags = new Set<string>();
  const operands: string[] = [];
  for (const a of args) {
    if (a.startsWith("-") && a.length > 1 && !/^-\d+$/.test(a)) {
      for (const ch of a.slice(1)) flags.add(ch);
    } else {
      operands.push(a);
    }
  }
  return { flags, operands };
}

// Parse a `-n N` / `-nN` / `-N` line count for head/tail; the rest are files.
function parseLineCount(args: string[]): { n: number; files: string[]; err?: string } {
  let n = 10;
  const files: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? "";
    if (a === "-n") {
      const v = args[i + 1];
      i += 1;
      if (v === undefined || !/^\d+$/.test(v)) return { n, files, err: "invalid number of lines" };
      n = Number(v);
    } else if (/^-n\d+$/.test(a)) {
      n = Number(a.slice(2));
    } else if (/^-\d+$/.test(a)) {
      n = Number(a.slice(1));
    } else {
      files.push(a);
    }
  }
  return { n, files };
}

const pathComplete = (ctx: { vfs: import("../vfs").Vfs; cwd: string; current: string }): string[] =>
  completePath(ctx.vfs, ctx.cwd, ctx.current);

export const grep: Command = {
  name: "grep",
  summary: "search input for a pattern",
  usage: "grep [-ivncE] PATTERN [FILE...]",
  details: "Print lines matching PATTERN (a regular expression). Reads files, or standard input when none are given. -i ignore case, -v invert match, -n prefix line numbers, -c print only the count, -E extended regex.",
  complete: pathComplete,
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const pattern = operands.shift();
    if (pattern === undefined) { ctx.writeln(red("usage: grep [-ivncE] PATTERN [FILE...]")); return 2; }

    const ci = flags.has("i");
    let re: RegExp;
    try { re = new RegExp(pattern, ci ? "i" : ""); }
    catch { ctx.writeln(red(`grep: invalid pattern: ${pattern}`)); return 2; }

    const invert = flags.has("v");
    const { lines, code } = inputLines(ctx, "grep", operands);
    let matches = 0;
    lines.forEach((line, i) => {
      if (re.test(line) === invert) return;
      matches += 1;
      if (flags.has("c")) return;
      let display = line;
      if (!invert) {
        try {
          display = line.replace(new RegExp(pattern, ci ? "ig" : "g"), (m) => (m ? color(PALETTE.red, m) : m));
        } catch { /* keep the line unhighlighted */ }
      }
      if (flags.has("n")) {
        display = `${color(PALETTE.green, String(i + 1))}${color(PALETTE.cyan, ":")}${display}`;
      }
      ctx.writeln(display);
    });
    if (flags.has("c")) ctx.writeln(String(matches));
    return code !== 0 ? code : matches > 0 ? 0 : 1;
  },
};

export const head: Command = {
  name: "head",
  summary: "output the first lines of input",
  usage: "head [-n N] [FILE...]",
  details: "Print the first N lines (default 10) of each file, or of standard input when none are given.",
  complete: pathComplete,
  run(ctx) {
    const { n, files, err } = parseLineCount(ctx.args);
    if (err) { ctx.writeln(red(`head: ${err}`)); return 2; }
    const { lines, code } = inputLines(ctx, "head", files);
    for (const l of lines.slice(0, n)) ctx.writeln(l);
    return code;
  },
};

export const tail: Command = {
  name: "tail",
  summary: "output the last lines of input",
  usage: "tail [-n N] [FILE...]",
  details: "Print the last N lines (default 10) of each file, or of standard input when none are given.",
  complete: pathComplete,
  run(ctx) {
    const { n, files, err } = parseLineCount(ctx.args);
    if (err) { ctx.writeln(red(`tail: ${err}`)); return 2; }
    const { lines, code } = inputLines(ctx, "tail", files);
    const tailLines = n <= 0 ? [] : lines.slice(-n);
    for (const l of tailLines) ctx.writeln(l);
    return code;
  },
};

export const wc: Command = {
  name: "wc",
  summary: "count lines, words, and characters",
  usage: "wc [-lwc] [FILE...]",
  details: "Print line, word, and character counts for each file, or for standard input. -l, -w, -c select individual counts.",
  complete: pathComplete,
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const { lines, code } = inputLines(ctx, "wc", operands);
    const lineCount = lines.length;
    const wordCount = lines.reduce((m, l) => m + (l.trim() ? l.trim().split(/\s+/).length : 0), 0);
    const charCount = lines.reduce((m, l) => m + l.length + 1, 0);
    const any = flags.has("l") || flags.has("w") || flags.has("c");
    const parts: string[] = [];
    if (!any || flags.has("l")) parts.push(String(lineCount).padStart(4));
    if (!any || flags.has("w")) parts.push(String(wordCount).padStart(4));
    if (!any || flags.has("c")) parts.push(String(charCount).padStart(4));
    ctx.writeln(parts.join(" ") + (operands.length === 1 ? ` ${operands[0]}` : ""));
    return code;
  },
};

export const sort: Command = {
  name: "sort",
  summary: "sort lines of input",
  usage: "sort [-rnuf] [FILE...]",
  details: "Sort lines from the files, or from standard input. -r reverse, -n numeric, -f fold case, -u drop duplicates.",
  complete: pathComplete,
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const { lines, code } = inputLines(ctx, "sort", operands);
    const numeric = flags.has("n");
    const fold = flags.has("f");
    let result = [...lines].sort((a, b) => {
      if (numeric) return (parseFloat(a) || 0) - (parseFloat(b) || 0);
      const x = fold ? a.toLowerCase() : a;
      const y = fold ? b.toLowerCase() : b;
      return x < y ? -1 : x > y ? 1 : 0;
    });
    if (flags.has("r")) result.reverse();
    if (flags.has("u")) result = result.filter((l, i) => i === 0 || l !== result[i - 1]);
    for (const l of result) ctx.writeln(l);
    return code;
  },
};

export const tru: Command = {
  name: "true",
  summary: "do nothing, successfully",
  run() { return 0; },
};

export const fls: Command = {
  name: "false",
  summary: "do nothing, unsuccessfully",
  run() { return 1; },
};
