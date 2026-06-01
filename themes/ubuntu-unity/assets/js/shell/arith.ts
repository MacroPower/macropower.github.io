// Integer arithmetic evaluator for $(( ... )), mirroring bash's operator set and
// precedence. Bare identifiers resolve through `lookup` and are themselves
// evaluated as arithmetic (recursively, unset -> 0), as in bash. Values are JS
// numbers truncated toward zero, so arithmetic and comparisons cover bash's
// full integer range; the bitwise/shift operators (& | ^ ~ << >>) use JS's
// 32-bit operators, a divergence from bash's 64-bit width for large operands.
// Pure and DOM-free.

export type ArithLookup = (name: string) => string;

const NAME_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUM_RE = /0[xX][0-9a-fA-F]+|0[0-7]+|\d+/y;
const HEX_RE = /^0[xX]/;
const OCTAL_RE = /^0[0-7]+$/;
const INT_RE = /^[+-]?\d+$/;
const MULTI_OPS = new Set(["**", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||"]);

type Tok = { t: "num"; v: number } | { t: "name"; v: string } | { t: "op"; v: string } | { t: "end" };

function tokenize(expr: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i] ?? "")) { i += 1; continue; }
    NUM_RE.lastIndex = i;
    const num = NUM_RE.exec(expr);
    if (num && num.index === i) {
      const raw = num[0];
      let v: number;
      if (HEX_RE.test(raw)) v = parseInt(raw, 16);
      else if (OCTAL_RE.test(raw)) v = parseInt(raw, 8);
      else v = parseInt(raw, 10);
      toks.push({ t: "num", v });
      i = NUM_RE.lastIndex;
      continue;
    }
    NAME_RE.lastIndex = i;
    const name = NAME_RE.exec(expr);
    if (name && name.index === i) {
      toks.push({ t: "name", v: name[0] });
      i = NAME_RE.lastIndex;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (MULTI_OPS.has(two)) { toks.push({ t: "op", v: two }); i += 2; continue; }
    const one = expr[i] ?? "";
    if ("-+*/%()~!<>&^|?:,".includes(one)) { toks.push({ t: "op", v: one }); i += 1; continue; }
    throw new Error(`bad arithmetic token: ${one}`);
  }
  toks.push({ t: "end" });
  return toks;
}

const toInt = (n: number): number => (n < 0 ? Math.ceil(n) : Math.floor(n));

export function evalArith(expr: string, lookup: ArithLookup, depth = 0): number {
  const toks = tokenize(expr);
  let pos = 0;
  const peek = (): Tok => toks[pos] ?? { t: "end" };
  const eat = (v?: string): Tok => {
    const tk = toks[pos];
    if (v !== undefined && (tk?.t !== "op" || tk.v !== v)) throw new Error(`expected '${v}'`);
    pos += 1;
    return tk ?? { t: "end" };
  };
  const isOp = (v: string): boolean => { const tk = peek(); return tk.t === "op" && tk.v === v; };

  // comma (lowest) -> ternary -> || -> && -> | -> ^ -> & -> eq -> rel -> shift
  // -> add -> mul -> power -> unary -> primary.
  const comma = (): number => {
    let v = ternary();
    while (isOp(",")) { eat(","); v = ternary(); }
    return v;
  };
  const ternary = (): number => {
    const cond = logicalOr();
    if (isOp("?")) {
      eat("?");
      const a = ternary();
      eat(":");
      const b = ternary();
      return cond !== 0 ? a : b;
    }
    return cond;
  };
  const logicalOr = (): number => {
    let v = logicalAnd();
    while (isOp("||")) { eat("||"); const r = logicalAnd(); v = (v !== 0 || r !== 0) ? 1 : 0; }
    return v;
  };
  const logicalAnd = (): number => {
    let v = bitOr();
    while (isOp("&&")) { eat("&&"); const r = bitOr(); v = (v !== 0 && r !== 0) ? 1 : 0; }
    return v;
  };
  const bitOr = (): number => { let v = bitXor(); while (isOp("|")) { eat("|"); v |= bitXor(); } return v; };
  const bitXor = (): number => { let v = bitAnd(); while (isOp("^")) { eat("^"); v ^= bitAnd(); } return v; };
  const bitAnd = (): number => { let v = equality(); while (isOp("&")) { eat("&"); v &= equality(); } return v; };
  const equality = (): number => {
    let v = relational();
    for (;;) {
      if (isOp("==")) { eat("=="); v = v === relational() ? 1 : 0; }
      else if (isOp("!=")) { eat("!="); v = v !== relational() ? 1 : 0; }
      else break;
    }
    return v;
  };
  const relational = (): number => {
    let v = shift();
    for (;;) {
      if (isOp("<=")) { eat("<="); v = v <= shift() ? 1 : 0; }
      else if (isOp(">=")) { eat(">="); v = v >= shift() ? 1 : 0; }
      else if (isOp("<")) { eat("<"); v = v < shift() ? 1 : 0; }
      else if (isOp(">")) { eat(">"); v = v > shift() ? 1 : 0; }
      else break;
    }
    return v;
  };
  const shift = (): number => {
    let v = additive();
    for (;;) {
      if (isOp("<<")) { eat("<<"); v <<= additive(); }
      else if (isOp(">>")) { eat(">>"); v >>= additive(); }
      else break;
    }
    return v;
  };
  const additive = (): number => {
    let v = multiplicative();
    for (;;) {
      if (isOp("+")) { eat("+"); v += multiplicative(); }
      else if (isOp("-")) { eat("-"); v -= multiplicative(); }
      else break;
    }
    return v;
  };
  const multiplicative = (): number => {
    let v = power();
    for (;;) {
      if (isOp("*")) { eat("*"); v = toInt(v * power()); }
      else if (isOp("/")) { eat("/"); const d = power(); if (d === 0) throw new Error("division by 0"); v = toInt(v / d); }
      else if (isOp("%")) { eat("%"); const d = power(); if (d === 0) throw new Error("division by 0"); v = v % d; }
      else break;
    }
    return v;
  };
  const power = (): number => {
    const base = unary();
    if (isOp("**")) { eat("**"); return toInt(base ** power()); }
    return base;
  };
  const unary = (): number => {
    if (isOp("-")) { eat("-"); return -unary(); }
    if (isOp("+")) { eat("+"); return unary(); }
    if (isOp("!")) { eat("!"); return unary() === 0 ? 1 : 0; }
    if (isOp("~")) { eat("~"); return ~unary(); }
    return primary();
  };
  const primary = (): number => {
    const tk = peek();
    if (tk.t === "op" && tk.v === "(") { eat("("); const v = comma(); eat(")"); return v; }
    if (tk.t === "num") { pos += 1; return tk.v; }
    if (tk.t === "name") {
      pos += 1;
      const raw = lookup(tk.v).trim();
      if (raw === "") return 0;
      if (depth > 32) throw new Error("arithmetic recursion too deep");
      if (INT_RE.test(raw)) return Number(raw);
      return evalArith(raw, lookup, depth + 1);
    }
    throw new Error("unexpected end of arithmetic expression");
  };

  const result = comma();
  if (peek().t !== "end") throw new Error("trailing tokens in arithmetic expression");
  return toInt(result);
}
