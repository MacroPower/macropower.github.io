// POSIX-flavored builtins: the no-op `:`, the `test`/`[` conditional, and
// `printf`. These mirror the bash builtins (the conformance harness diffs
// against `bash -c`), not the coreutils binaries.

import type { Command, CommandContext } from "../shell";
import { color, PALETTE } from "../ansi";
import { decodeEscape } from "./escapes";

const red = (s: string): string => color(PALETTE.red, s);
const INT_RE = /^[+-]?\d+$/;

export const colon: Command = {
  name: ":",
  summary: "do nothing, successfully",
  usage: ":",
  details: "The null command. Expands arguments and returns success (0).",
  hidden: true,
  run() { return 0; },
};

// --- test / [ -------------------------------------------------------------

const UNARY_STR = new Set(["-z", "-n"]);
const UNARY_FILE = new Set(["-e", "-f", "-d", "-r", "-w", "-x", "-s"]);
const BINARY_STR = new Set(["=", "==", "!=", "<", ">"]);
const BINARY_INT = new Set(["-eq", "-ne", "-lt", "-le", "-gt", "-ge"]);

class TestError extends Error {}

// Recursive-descent evaluator over the already-tokenized operands, supporting
// `!`, `-a`, `-o`, parentheses, and the string/integer/file primaries. This
// approximates bash's `[` for the common shapes; it does not reproduce the
// arg-count special cases of the POSIX grammar.
class TestEval {
  private i = 0;
  constructor(private readonly toks: string[], private readonly ctx: CommandContext) {}

  eval(): boolean {
    const r = this.orExpr();
    if (this.i !== this.toks.length) {
      throw new TestError(`too many arguments`);
    }
    return r;
  }

  private peek(): string | undefined { return this.toks[this.i]; }
  private next(): string { const t = this.toks[this.i]; this.i += 1; return t ?? ""; }

  private orExpr(): boolean {
    let r = this.andExpr();
    while (this.peek() === "-o") { this.next(); const rhs = this.andExpr(); r = r || rhs; }
    return r;
  }

  private andExpr(): boolean {
    let r = this.unary();
    while (this.peek() === "-a") { this.next(); const rhs = this.unary(); r = r && rhs; }
    return r;
  }

  private unary(): boolean {
    if (this.peek() === "!") { this.next(); return !this.unary(); }
    return this.primary();
  }

  private primary(): boolean {
    const t = this.peek();
    if (t === undefined) throw new TestError("argument expected");
    if (t === "(") {
      this.next();
      const r = this.orExpr();
      if (this.next() !== ")") throw new TestError("')' expected");
      return r;
    }
    if (UNARY_STR.has(t) || UNARY_FILE.has(t)) {
      // A unary operator is only an operator when an operand follows; bash
      // otherwise treats it as a plain string (`[ -z ]` -> true, non-empty).
      const after = this.toks[this.i + 1];
      if (after !== undefined && !this.isCloser(after)) {
        this.next();
        return this.applyUnary(t, this.next());
      }
    }
    // A string, possibly the left side of a binary operator.
    const lhs = this.next();
    const op = this.peek();
    if (op !== undefined && (BINARY_STR.has(op) || BINARY_INT.has(op))) {
      this.next();
      const rhs = this.next();
      return this.applyBinary(lhs, op, rhs);
    }
    return lhs.length > 0;
  }

  private isCloser(t: string): boolean {
    return t === ")" || t === "-a" || t === "-o";
  }

  private applyUnary(op: string, operand: string): boolean {
    switch (op) {
      case "-z": return operand.length === 0;
      case "-n": return operand.length > 0;
      default: return this.fileTest(op, operand);
    }
  }

  private fileTest(op: string, path: string): boolean {
    const node = this.ctx.vfs.lookup(this.ctx.vfs.resolvePath(this.ctx.cwd(), path));
    switch (op) {
      case "-e": return node !== undefined;
      case "-f": return node?.kind === "file";
      case "-d": return node?.kind === "dir";
      case "-s": return node?.kind === "file" && node.size > 0;
      case "-r": case "-w": case "-x": return node !== undefined;
      default: return false;
    }
  }

  private applyBinary(lhs: string, op: string, rhs: string): boolean {
    if (BINARY_INT.has(op)) {
      const a = this.toInt(lhs);
      const b = this.toInt(rhs);
      switch (op) {
        case "-eq": return a === b;
        case "-ne": return a !== b;
        case "-lt": return a < b;
        case "-le": return a <= b;
        case "-gt": return a > b;
        case "-ge": return a >= b;
        default: return false;
      }
    }
    switch (op) {
      case "=": case "==": return lhs === rhs;
      case "!=": return lhs !== rhs;
      case "<": return lhs < rhs;
      case ">": return lhs > rhs;
      default: return false;
    }
  }

  private toInt(s: string): number {
    if (!INT_RE.test(s.trim())) {
      throw new TestError(`integer expression expected: ${s}`);
    }
    return Number(s.trim());
  }
}

function runTest(ctx: CommandContext, toks: string[]): number {
  try {
    return new TestEval(toks, ctx).eval() ? 0 : 1;
  } catch (e) {
    const msg = e instanceof TestError ? e.message : "syntax error";
    ctx.errln(red(`${ctx.name}: ${msg}`));
    return 2;
  }
}

export const test: Command = {
  name: "test",
  summary: "evaluate a conditional expression",
  usage: "test EXPRESSION",
  details: "Evaluate EXPRESSION and return 0 (true) or 1 (false). Supports string tests (-z -n = != < >), integer tests (-eq -ne -lt -le -gt -ge), file tests (-e -f -d), negation (!), and -a / -o.",
  run(ctx) { return runTest(ctx, ctx.args); },
};

export const testBracket: Command = {
  name: "[",
  summary: "evaluate a conditional expression",
  usage: "[ EXPRESSION ]",
  details: "Like `test`, but the final argument must be a literal `]`.",
  hidden: true,
  run(ctx) {
    const args = ctx.args;
    if (args[args.length - 1] !== "]") {
      ctx.errln(red("[: missing `]'"));
      return 2;
    }
    return runTest(ctx, args.slice(0, -1));
  },
};

// --- printf ---------------------------------------------------------------

const SPEC_RE = /^%([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdioxXuc])/;

function pad(s: string, width: number, left: boolean, zero: boolean): string {
  if (s.length >= width) return s;
  const fill = (zero && !left ? "0" : " ").repeat(width - s.length);
  return left ? s + " ".repeat(width - s.length) : fill + s;
}

export const printf: Command = {
  name: "printf",
  summary: "format and print data",
  usage: "printf FORMAT [ARGUMENT...]",
  details: "Write ARGUMENTs under the control of FORMAT (%s %d %i %x %o %c %%), reusing FORMAT until all arguments are consumed. Interprets \\n \\t \\\\ \\r \\a and \\0NNN escapes.",
  run(ctx) {
    const fmt = ctx.args[0];
    if (fmt === undefined) { ctx.errln(red("printf: usage: printf format [arguments]")); return 2; }
    const args = ctx.args.slice(1);
    let ai = 0;
    let out = "";
    let status = 0;

    const toInt = (s: string | undefined): number => {
      const v = s ?? "";
      if (v === "") return 0;
      if (INT_RE.test(v.trim())) return Number(v.trim());
      ctx.errln(red(`printf: ${v}: invalid number`));
      status = 1;
      return 0;
    };

    const onePass = (): void => {
      let i = 0;
      while (i < fmt.length) {
        const ch = fmt[i];
        if (ch === "\\") { const e = decodeEscape(fmt, i); out += e.text; i += e.len; continue; }
        if (ch !== "%") { out += ch; i += 1; continue; }
        if (fmt[i + 1] === "%") { out += "%"; i += 2; continue; }
        const m = SPEC_RE.exec(fmt.slice(i));
        if (!m) { out += ch; i += 1; continue; }
        const [whole, flags = "", widthS, precS, conv] = m;
        const left = flags.includes("-");
        const zero = flags.includes("0");
        const width = widthS ? Number(widthS) : 0;
        const prec = precS !== undefined ? Number(precS) : undefined;
        const arg = args[ai];
        ai += 1;
        out += formatOne(conv ?? "s", arg, { left, zero, width, prec }, toInt);
        i += whole.length;
      }
    };

    // Reprocess the format until args are exhausted; a pass that consumes no
    // arg ends the loop (a format with no conversions runs exactly once).
    do {
      const before = ai;
      onePass();
      if (ai === before) break;
    } while (ai < args.length);

    ctx.write(out);
    return status;
  },
};

function formatOne(
  conv: string,
  arg: string | undefined,
  o: { left: boolean; zero: boolean; width: number; prec?: number },
  toInt: (s: string | undefined) => number,
): string {
  let body: string;
  let zero = o.zero;
  switch (conv) {
    case "s": {
      body = arg ?? "";
      if (o.prec !== undefined) body = body.slice(0, o.prec);
      zero = false;
      break;
    }
    case "c": body = (arg ?? "").slice(0, 1); zero = false; break;
    case "d": case "i": body = applyIntPrec(String(Math.trunc(toInt(arg))), o.prec); break;
    case "u": body = applyIntPrec(String(Math.abs(Math.trunc(toInt(arg)))), o.prec); break;
    case "x": body = applyIntPrec((toInt(arg) >>> 0).toString(16), o.prec); break;
    case "X": body = applyIntPrec((toInt(arg) >>> 0).toString(16).toUpperCase(), o.prec); break;
    case "o": body = applyIntPrec((toInt(arg) >>> 0).toString(8), o.prec); break;
    default: body = arg ?? "";
  }
  return pad(body, o.width, o.left, zero);
}

// A precision on an integer conversion is a minimum digit count (zero-padded).
function applyIntPrec(digits: string, prec?: number): string {
  if (prec === undefined) return digits;
  const neg = digits.startsWith("-");
  const bare = neg ? digits.slice(1) : digits;
  const padded = bare.padStart(prec, "0");
  return neg ? `-${padded}` : padded;
}
