// Text-filter commands. Each reads its file operands, or standard input (the
// left side of a pipe) when no files are given, mirroring the real utilities.

import type { Command, CommandContext } from "../shell";
import { color, PALETTE, stripAnsi } from "../ansi";
import { completePath } from "../vfs";

const red = (s: string): string => color(PALETTE.red, s);

// Resolve the input lines for a filter: file operands (ANSI-stripped) if any,
// otherwise the piped stdin. Missing/dir operands print an error and set code.
export function inputLines(
  ctx: CommandContext,
  cmd: string,
  files: string[],
): { lines: string[]; code: number } {
  if (files.length === 0) return { lines: ctx.stdin, code: 0 };
  const lines: string[] = [];
  let code = 0;
  for (const f of files) {
    const node = ctx.vfs.lookup(ctx.vfs.resolvePath(ctx.cwd(), f));
    if (!node) { ctx.errln(red(`${cmd}: ${f}: No such file or directory`)); code = 1; continue; }
    if (node.kind === "dir") { ctx.errln(red(`${cmd}: ${f}: Is a directory`)); code = 1; continue; }
    for (const l of node.content()) lines.push(stripAnsi(l));
  }
  return { lines, code };
}

export function splitFlags(args: string[]): { flags: Set<string>; operands: string[] } {
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

export const pathComplete = (ctx: { vfs: import("../vfs").Vfs; cwd: string; current: string }): string[] =>
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
    if (pattern === undefined) { ctx.errln(red("usage: grep [-ivncE] PATTERN [FILE...]")); return 2; }

    const ci = flags.has("i");
    let re: RegExp;
    try { re = new RegExp(pattern, ci ? "i" : ""); }
    catch { ctx.errln(red(`grep: invalid pattern: ${pattern}`)); return 2; }

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
    if (err) { ctx.errln(red(`head: ${err}`)); return 2; }
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
    if (err) { ctx.errln(red(`tail: ${err}`)); return 2; }
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
    const counts: number[] = [];
    if (flags.has("l")) counts.push(lineCount);
    if (flags.has("w")) counts.push(wordCount);
    if (flags.has("c")) counts.push(charCount);
    // A single selected count prints bare (matching bash `wc -l`); the default
    // three-column form stays right-aligned.
    const single = counts.length === 1;
    const fields = (counts.length ? counts : [lineCount, wordCount, charCount])
      .map((n) => (single ? String(n) : String(n).padStart(4)));
    ctx.writeln(fields.join(" ") + (operands.length === 1 ? ` ${operands[0]}` : ""));
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

// Parse a cut LIST ("1", "1,3", "2-", "-3", "1-5") into inclusive ranges; an
// open upper bound becomes Infinity. Returns null on a malformed field.
function parseRanges(spec: string): [number, number][] | null {
  const ranges: [number, number][] = [];
  for (const part of spec.split(",")) {
    let m: RegExpExecArray | null;
    if (/^\d+$/.test(part)) { const n = Number(part); ranges.push([n, n]); }
    else if ((m = /^(\d+)-$/.exec(part))) ranges.push([Number(m[1]), Infinity]);
    else if ((m = /^-(\d+)$/.exec(part))) ranges.push([1, Number(m[1])]);
    else if ((m = /^(\d+)-(\d+)$/.exec(part))) ranges.push([Number(m[1]), Number(m[2])]);
    else return null;
  }
  return ranges;
}

const inRanges = (i: number, ranges: [number, number][]): boolean =>
  ranges.some(([lo, hi]) => i >= lo && i <= hi);

export const cut: Command = {
  name: "cut",
  summary: "extract fields or characters from each line",
  usage: "cut -f LIST [-d DELIM] | cut -c LIST [FILE...]",
  details: "Print selected parts of each line. -f selects delimited fields (-d sets the delimiter, default TAB); -c selects character positions. LIST is a comma-separated set of N, N-, -M, or N-M ranges.",
  complete: pathComplete,
  run(ctx) {
    let delim = "\t";
    let fieldSpec: string | undefined;
    let charSpec: string | undefined;
    const files: string[] = [];
    const args = ctx.args;
    for (let i = 0; i < args.length; i += 1) {
      const a = args[i] ?? "";
      if (a === "-d") { delim = args[i + 1] ?? ""; i += 1; }
      else if (a.startsWith("-d")) delim = a.slice(2);
      else if (a === "-f") { fieldSpec = args[i + 1]; i += 1; }
      else if (a.startsWith("-f")) fieldSpec = a.slice(2);
      else if (a === "-c") { charSpec = args[i + 1]; i += 1; }
      else if (a.startsWith("-c")) charSpec = a.slice(2);
      else files.push(a);
    }
    const spec = charSpec ?? fieldSpec;
    if (spec === undefined) { ctx.errln(red("cut: you must specify a list of bytes, characters, or fields")); return 1; }
    const ranges = parseRanges(spec);
    if (!ranges) { ctx.errln(red(`cut: invalid field value '${spec}'`)); return 1; }
    const d = delim.length > 0 ? (delim[0] as string) : "\t";
    const { lines, code } = inputLines(ctx, "cut", files);
    for (const line of lines) {
      if (charSpec !== undefined) {
        const chars = [...line];
        ctx.writeln(chars.filter((_, idx) => inRanges(idx + 1, ranges)).join(""));
      } else if (!line.includes(d)) {
        ctx.writeln(line);
      } else {
        const fields = line.split(d);
        ctx.writeln(fields.filter((_, idx) => inRanges(idx + 1, ranges)).join(d));
      }
    }
    return code;
  },
};

// Expand a tr SET into its characters: ranges (a-z) enumerate, and the common
// escapes (\n \t \r \\) decode.
function expandSet(s: string): string[] {
  const out: string[] = [];
  const esc: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\" };
  let i = 0;
  while (i < s.length) {
    if (s[i] === "\\" && i + 1 < s.length) { const e = s[i + 1] as string; out.push(esc[e] ?? e); i += 2; continue; }
    if (s[i + 1] === "-" && i + 2 < s.length && s[i + 2] !== "\\") {
      const a = (s[i] as string).charCodeAt(0);
      const b = (s[i + 2] as string).charCodeAt(0);
      if (a <= b) { for (let c = a; c <= b; c += 1) out.push(String.fromCharCode(c)); i += 3; continue; }
    }
    out.push(s[i] as string);
    i += 1;
  }
  return out;
}

export const tr: Command = {
  name: "tr",
  summary: "translate or delete characters",
  usage: "tr [-d] SET1 [SET2]",
  details: "Translate characters in SET1 to the matching ones in SET2, reading standard input. With -d, delete the characters in SET1 instead. Sets may use ranges like a-z.",
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const set1 = operands[0];
    if (set1 === undefined) { ctx.errln(red("tr: missing operand")); return 1; }
    const s1 = expandSet(set1);
    if (flags.has("d")) {
      const drop = new Set(s1);
      for (const line of ctx.stdin) ctx.writeln([...line].filter((c) => !drop.has(c)).join(""));
      return 0;
    }
    const set2 = operands[1];
    if (set2 === undefined) { ctx.errln(red(`tr: missing operand after '${set1}'`)); return 1; }
    const s2 = expandSet(set2);
    const last = s2.length - 1;
    const map = new Map<string, string>();
    s1.forEach((c, idx) => { map.set(c, s2[Math.min(idx, last)] ?? c); });
    for (const line of ctx.stdin) ctx.writeln([...line].map((c) => map.get(c) ?? c).join(""));
    return 0;
  },
};

export const uniq: Command = {
  name: "uniq",
  summary: "drop adjacent duplicate lines",
  usage: "uniq [-c] [FILE]",
  details: "Collapse runs of identical adjacent lines into one. -c prefixes each line with the number of times it occurred. Input is usually sorted first.",
  complete: pathComplete,
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const { lines, code } = inputLines(ctx, "uniq", operands);
    const count = flags.has("c");
    let i = 0;
    while (i < lines.length) {
      let j = i + 1;
      while (j < lines.length && lines[j] === lines[i]) j += 1;
      if (count) ctx.writeln(`${String(j - i).padStart(7)} ${lines[i]}`);
      else ctx.writeln(lines[i] as string);
      i = j;
    }
    return code;
  },
};

export const rev: Command = {
  name: "rev",
  summary: "reverse the characters of each line",
  usage: "rev [FILE...]",
  details: "Print each line of the input with its characters in reverse order.",
  complete: pathComplete,
  run(ctx) {
    const { lines, code } = inputLines(ctx, "rev", ctx.args);
    for (const l of lines) ctx.writeln([...l].reverse().join(""));
    return code;
  },
};

export const tac: Command = {
  name: "tac",
  summary: "print lines in reverse order",
  usage: "tac [FILE...]",
  details: "Concatenate the input and print its lines from last to first.",
  complete: pathComplete,
  run(ctx) {
    const { lines, code } = inputLines(ctx, "tac", ctx.args);
    for (let i = lines.length - 1; i >= 0; i -= 1) ctx.writeln(lines[i] as string);
    return code;
  },
};

export const nl: Command = {
  name: "nl",
  summary: "number the lines of input",
  usage: "nl [FILE...]",
  details: "Write the input to standard output with non-empty lines numbered in a right-justified, tab-separated column. Empty lines are printed without a number.",
  complete: pathComplete,
  run(ctx) {
    const { lines, code } = inputLines(ctx, "nl", ctx.args);
    let n = 1;
    for (const l of lines) {
      if (l === "") { ctx.writeln(""); continue; }
      ctx.writeln(`${String(n).padStart(6)}\t${l}`);
      n += 1;
    }
    return code;
  },
};

// Format a seq value: integers bare, fractions trimmed of accumulation noise.
function formatSeq(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
}

export const seq: Command = {
  name: "seq",
  summary: "print a sequence of numbers",
  usage: "seq LAST | seq FIRST LAST | seq FIRST STEP LAST",
  details: "Print numbers from FIRST (default 1) to LAST in increments of STEP (default 1), one per line. Fractional values print with their natural precision rather than GNU seq's uniform decimal width.",
  run(ctx) {
    const nums = ctx.args.map(Number);
    let first = 1;
    let step = 1;
    let last: number;
    if (nums.length === 1) { last = nums[0] as number; }
    else if (nums.length === 2) { first = nums[0] as number; last = nums[1] as number; }
    else if (nums.length === 3) { first = nums[0] as number; step = nums[1] as number; last = nums[2] as number; }
    else { ctx.errln(red("seq: missing operand")); return 1; }
    if ([first, step, last].some((n) => !Number.isFinite(n)) || step === 0) {
      ctx.errln(red(`seq: invalid argument`));
      return 1;
    }
    const eps = 1e-9;
    if (step > 0) for (let v = first; v <= last + eps; v += step) ctx.writeln(formatSeq(v));
    else for (let v = first; v >= last - eps; v += step) ctx.writeln(formatSeq(v));
    return 0;
  },
};

export const tee: Command = {
  name: "tee",
  summary: "copy standard input to files and stdout",
  usage: "tee [-a] FILE...",
  details: "Read standard input and write it to standard output and to each FILE. -a appends to the files instead of overwriting them.",
  complete: pathComplete,
  run(ctx) {
    const { flags, operands } = splitFlags(ctx.args);
    const append = flags.has("a");
    const body = ctx.stdin.length ? `${ctx.stdin.join("\n")}\n` : "";
    let code = 0;
    for (const f of operands) {
      const err = ctx.vfs.writeFile(ctx.vfs.resolvePath(ctx.cwd(), f), body, { append });
      if (err) { ctx.errln(red(`tee: ${f}: ${err}`)); code = 1; }
    }
    for (const l of ctx.stdin) ctx.writeln(l);
    return code;
  },
};

export const tru: Command = {
  name: "true",
  builtin: true,
  summary: "do nothing, successfully",
  run() { return 0; },
};

export const fls: Command = {
  name: "false",
  builtin: true,
  summary: "do nothing, unsuccessfully",
  run() { return 1; },
};
