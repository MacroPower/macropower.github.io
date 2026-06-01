// Command-line parser for the home terminal: turns a raw input line into a list
// of statements (separated by ; && ||), each a pipeline of simple commands
// (separated by |) with redirections. Pure and DOM-free.
//
// Quotes, escapes, and ~ resolve at parse time. Everything that depends on
// runtime state stays an unresolved Word part: $parameters, ${...} expansions,
// $(...) / `...` command substitutions, and $(( )) arithmetic. The shell
// expands those into fields just before a command runs, so $? and same-line
// assignments read live values. Quoting gates expansion the way a real shell
// does -- a parameter inside single quotes is literal -- and tracks per-part
// quoting so unquoted expansions can be word-split while quoted ones are not.

// Source for tilde expansion (resolved while parsing).
export interface ParseEnv {
  home: string;
}

export type Operator = "|" | "&&" | "||" | ";";
export type Connector = ";" | "&&" | "||";

// A ${VAR op word} parameter expansion. `op` is "" for a bare ${VAR}, "len"
// for ${#VAR}, one of the :-/:=/:+/:? (and unset-only -/=/+/?) defaults, or a
// #/##/%/%% (strip) or ///// (replace) pattern operator. `word` is the operand,
// re-tokenized so it expands recursively.
export interface ParamExpr {
  name: string;
  op: string;
  word: Word;
}

export type WordPart =
  | { lit: string }
  | { param: string; quoted?: boolean }
  | { paramExpr: ParamExpr; quoted?: boolean }
  | { cmdsub: ParseResult; quoted?: boolean }
  | { arith: string; quoted?: boolean };

export interface Word {
  parts: WordPart[];
  /** True if the word contained quotes. A word whose only content is an empty
   *  quote ("") has no parts but quoted=true, so it still yields one field. */
  quoted: boolean;
  /** True when an unquoted literal glob metacharacter (* ? [) was consumed,
   *  marking the word eligible for filename globbing after expansion. */
  hasUnquotedGlob: boolean;
}

// A redirection on a simple command. "file" sends an fd to a path (the VFS is
// read-only, so any real target fails); "dup" points one fd at another (2>&1).
export type Redirect =
  | { kind: "file"; fd: number; op: ">" | ">>"; target: Word }
  | { kind: "dup"; fd: number; toFd: number };

export interface SimpleCommand {
  words: Word[];
  redirs: Redirect[];
}

export interface Statement {
  /** Connector preceding this statement (";" for the first). */
  connector: Connector;
  pipeline: SimpleCommand[];
}

export interface ParseResult {
  statements: Statement[];
  error?: string;
}

// A redirection token emitted by the tokenizer. "file"/"both" await a target
// word; "dup" stands alone. "both" is &> / &>> (stdout+stderr to one file).
type RedirSpec =
  | { kind: "file"; fd: number; op: ">" | ">>" }
  | { kind: "dup"; fd: number; toFd: number }
  | { kind: "both"; op: ">" | ">>" };

type Token =
  | { kind: "word"; word: Word }
  | { kind: "op"; value: Operator }
  | { kind: "redir"; spec: RedirSpec };

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;
const SPECIAL_PARAM = "?$#!*@-";

const EMPTY_WORD: Word = { parts: [], quoted: false, hasUnquotedGlob: false };

// Scan a balanced run starting just after an opening delimiter, returning the
// inner text and the index just past the closing delimiter. `open`/`close`
// nest; returns next=-1 when the closing delimiter is missing.
function scanBalanced(s: string, start: number, open: string, close: string): { inner: string; next: number } {
  let depth = 1;
  let i = start;
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) { i += 2; continue; }
    if (c === open) depth += 1;
    else if (c === close) { depth -= 1; if (depth === 0) return { inner: s.slice(start, i), next: i + 1 }; }
    i += 1;
  }
  return { inner: s.slice(start), next: -1 };
}

// Read a backtick command substitution at s[i] === "`".
function readBacktick(s: string, i: number, env: ParseEnv): { part: WordPart; next: number } {
  let j = i + 1;
  let inner = "";
  while (j < s.length && s[j] !== "`") {
    if (s[j] === "\\" && "`\\$".includes(s[j + 1] ?? "")) { inner += s[j + 1]; j += 2; continue; }
    inner += s[j];
    j += 1;
  }
  if (j >= s.length) return { part: { lit: "`" }, next: i + 1 };
  return { part: { cmdsub: parse(inner, env) }, next: j + 1 };
}

// Split a ${...} brace body into a ParamExpr (or a plain {param}).
function parseBraceBody(body: string, env: ParseEnv): WordPart {
  // ${#NAME} -- string length (but ${#} alone is the positional-count param).
  if (body[0] === "#" && body.length > 1) {
    return { paramExpr: { name: readName(body, 1).name, op: "len", word: EMPTY_WORD } };
  }
  const { name, next } = readName(body, 0);
  const rest = body.slice(next);
  if (rest === "") return { param: name };

  const two = rest.slice(0, 2);
  const ops2 = [":-", ":=", ":+", ":?", "##", "%%", "//"];
  let op: string;
  let operand: string;
  if (ops2.includes(two)) { op = two; operand = rest.slice(2); }
  else if ("-=+?#%/".includes(rest[0] ?? "")) { op = rest[0] ?? ""; operand = rest.slice(1); }
  else return { param: name };

  return { paramExpr: { name, op, word: { parts: parseWordParts(operand, env), quoted: false, hasUnquotedGlob: false } } };
}

// Read a parameter name (a NAME, a digit run, or a single special char) from
// `s` at `start`; return it and the index just past it.
function readName(s: string, start: number): { name: string; next: number } {
  const c = s[start];
  if (c !== undefined && NAME_START.test(c)) {
    let k = start;
    while (k < s.length && NAME_CHAR.test(s[k] ?? "")) k += 1;
    return { name: s.slice(start, k), next: k };
  }
  if (c !== undefined && /[0-9]/.test(c)) {
    let k = start;
    while (k < s.length && /[0-9]/.test(s[k] ?? "")) k += 1;
    return { name: s.slice(start, k), next: k };
  }
  if (c !== undefined && SPECIAL_PARAM.includes(c)) return { name: c, next: start + 1 };
  return { name: "", next: start };
}

// Read a `$...` reference at s[i] === "$": parameter, ${...}, $(...) command
// substitution, or $(( )) arithmetic. Returns a literal "$" when it is not a
// real reference.
function readDollar(s: string, i: number, env: ParseEnv): { part: WordPart; next: number } {
  const j = i + 1;
  const c = s[j];
  if (c === "{") {
    const { inner, next } = scanBalanced(s, j + 1, "{", "}");
    if (next === -1) return { part: { lit: `\${${inner}` }, next: s.length };
    return { part: parseBraceBody(inner, env), next };
  }
  if (c === "(") {
    if (s[j + 1] === "(") {
      const { inner, next } = scanBalanced(s, j + 2, "(", ")");
      // $(( expr )) closes on the inner ")"; consume the second ")" too.
      if (next !== -1 && s[next] === ")") return { part: { arith: inner }, next: next + 1 };
      // Fall through to command substitution when it is not arithmetic.
    }
    const { inner, next } = scanBalanced(s, j + 1, "(", ")");
    if (next === -1) return { part: { lit: "$" }, next: j };
    return { part: { cmdsub: parse(inner, env) }, next };
  }
  if (c !== undefined && SPECIAL_PARAM.includes(c)) return { part: { param: c }, next: j + 1 };
  if (c !== undefined && (NAME_START.test(c) || /[0-9]/.test(c))) {
    const { name, next } = readName(s, j);
    return { part: { param: name }, next };
  }
  return { part: { lit: "$" }, next: j };
}

// Parse an arbitrary string into one Word's parts (no word splitting), honoring
// quotes, escapes, $expansions, and backticks. Used for ${VAR:-WORD} operands.
function parseWordParts(s: string, env: ParseEnv): WordPart[] {
  const parts: WordPart[] = [];
  let lit = "";
  const flush = (): void => { if (lit) { parts.push({ lit }); lit = ""; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i] ?? "";
    if (c === "'") {
      i += 1;
      while (i < s.length && s[i] !== "'") { lit += s[i]; i += 1; }
      i += 1;
      continue;
    }
    if (c === '"') {
      i += 1;
      while (i < s.length && s[i] !== '"') {
        const d = s[i] ?? "";
        if (d === "\\" && '"\\$`'.includes(s[i + 1] ?? "")) { lit += s[i + 1]; i += 2; continue; }
        if (d === "$") { const r = readDollar(s, i, env); if ("lit" in r.part) lit += r.part.lit; else { flush(); parts.push(markQuoted(r.part)); } i = r.next; continue; }
        if (d === "`") { const r = readBacktick(s, i, env); flush(); parts.push(markQuoted(r.part)); i = r.next; continue; }
        lit += d; i += 1;
      }
      i += 1;
      continue;
    }
    if (c === "\\") { if (i + 1 < s.length) { lit += s[i + 1]; i += 2; } else { i += 1; } continue; }
    if (c === "$") { const r = readDollar(s, i, env); if ("lit" in r.part) lit += r.part.lit; else { flush(); parts.push(r.part); } i = r.next; continue; }
    if (c === "`") { const r = readBacktick(s, i, env); flush(); parts.push(r.part); i = r.next; continue; }
    lit += c; i += 1;
  }
  flush();
  return parts;
}

// Tag an expansion part as quoted so the shell suppresses word splitting.
function markQuoted(part: WordPart): WordPart {
  if ("lit" in part) return part;
  return { ...part, quoted: true };
}

function tokenize(line: string, env: ParseEnv): { tokens: Token[]; error?: string } {
  const tokens: Token[] = [];
  let parts: WordPart[] = [];
  let lit = "";
  let started = false;
  let quoted = false;
  let hasGlob = false;

  const flushLit = (): void => { if (lit) { parts.push({ lit }); lit = ""; } };
  const flushWord = (): void => {
    if (!started) return;
    flushLit();
    tokens.push({ kind: "word", word: { parts, quoted, hasUnquotedGlob: hasGlob } });
    parts = [];
    quoted = false;
    hasGlob = false;
    started = false;
  };
  const op = (value: Operator): void => { tokens.push({ kind: "op", value }); };
  const redir = (spec: RedirSpec): void => { tokens.push({ kind: "redir", spec }); };
  const dollar = (idx: number): number => {
    const r = readDollar(line, idx, env);
    if ("lit" in r.part) { lit += r.part.lit; } else { flushLit(); parts.push(r.part); }
    return r.next;
  };

  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i] ?? "";

    if (c === " " || c === "\t") { flushWord(); i += 1; continue; }
    if (c === "#" && !started) break; // comment to end of line (bash rule)

    if (c === "|") { flushWord(); if (line[i + 1] === "|") { op("||"); i += 2; } else { op("|"); i += 1; } continue; }

    // &> / &>> redirect both stdout and stderr; this must precede the lone-&
    // rule so the leading & is not mistaken for a backgrounding operator.
    if (c === "&" && line[i + 1] === ">") {
      flushWord();
      const append = line[i + 2] === ">";
      redir({ kind: "both", op: append ? ">>" : ">" });
      i += append ? 3 : 2;
      continue;
    }
    if (c === "&") { flushWord(); if (line[i + 1] === "&") { op("&&"); i += 2; } else { op(";"); i += 1; } continue; }
    if (c === ";") { flushWord(); op(";"); i += 1; continue; }

    if (c === ">") {
      // A bare all-digit unquoted word immediately before > is the fd.
      let fd = 1;
      if (started && parts.length === 0 && !quoted && /^[0-9]+$/.test(lit)) {
        fd = Number(lit); lit = ""; started = false;
      } else {
        flushWord();
      }
      if (line[i + 1] === "&" && /[0-9]/.test(line[i + 2] ?? "")) {
        let k = i + 2; let digits = "";
        while (k < n && /[0-9]/.test(line[k] ?? "")) { digits += line[k]; k += 1; }
        redir({ kind: "dup", fd, toFd: Number(digits) });
        i = k;
        continue;
      }
      const append = line[i + 1] === ">";
      redir({ kind: "file", fd, op: append ? ">>" : ">" });
      i += append ? 2 : 1;
      continue;
    }

    // Tilde expands only at the start of a word, before / or end-of-word.
    if (c === "~" && !started) {
      const nx = line[i + 1];
      if (nx === undefined || nx === "/" || nx === " " || nx === "\t") {
        started = true; lit += env.home; i += 1; continue;
      }
    }

    started = true;

    if (c === "'") {
      quoted = true;
      i += 1;
      while (i < n && line[i] !== "'") { lit += line[i]; i += 1; }
      if (i >= n) return { tokens: [], error: "unexpected EOF while looking for matching `''" };
      i += 1;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i += 1;
      while (i < n && line[i] !== '"') {
        const d = line[i] ?? "";
        if (d === "\\" && i + 1 < n && '"\\$`'.includes(line[i + 1] ?? "")) { lit += line[i + 1]; i += 2; continue; }
        if (d === "$") { flushLit(); const r = readDollar(line, i, env); if ("lit" in r.part) lit += r.part.lit; else parts.push(markQuoted(r.part)); i = r.next; continue; }
        if (d === "`") { flushLit(); const r = readBacktick(line, i, env); parts.push(markQuoted(r.part)); i = r.next; continue; }
        lit += d; i += 1;
      }
      if (i >= n) return { tokens: [], error: 'unexpected EOF while looking for matching `"\'' };
      i += 1;
      continue;
    }
    if (c === "\\") { if (i + 1 < n) { lit += line[i + 1]; i += 2; } else { i += 1; } continue; }
    if (c === "$") { i = dollar(i); continue; }
    if (c === "`") { flushLit(); const r = readBacktick(line, i, env); parts.push(r.part); i = r.next; continue; }
    if (c === "*" || c === "?" || c === "[") { hasGlob = true; lit += c; i += 1; continue; }
    lit += c; i += 1;
  }
  flushWord();
  return { tokens };
}

function syntaxError(near: string): ParseResult {
  return { statements: [], error: `syntax error near unexpected token \`${near}'` };
}

function buildStatements(tokens: Token[]): ParseResult {
  const statements: Statement[] = [];
  let pipeline: SimpleCommand[] = [];
  let cmd: SimpleCommand = { words: [], redirs: [] };
  let connector: Connector = ";";
  let pending: { kind: "file" | "both"; fd: number; op: ">" | ">>" } | null = null;

  const cmdEmpty = (): boolean => cmd.words.length === 0 && cmd.redirs.length === 0;
  const pushCmd = (): void => { pipeline.push(cmd); cmd = { words: [], redirs: [] }; };

  for (const tok of tokens) {
    if (tok.kind === "word") {
      if (pending) {
        if (pending.kind === "file") {
          cmd.redirs.push({ kind: "file", fd: pending.fd, op: pending.op, target: tok.word });
        } else {
          cmd.redirs.push({ kind: "file", fd: 1, op: pending.op, target: tok.word });
          cmd.redirs.push({ kind: "dup", fd: 2, toFd: 1 });
        }
        pending = null;
      } else {
        cmd.words.push(tok.word);
      }
      continue;
    }
    if (tok.kind === "redir") {
      if (pending) return syntaxError(tok.spec.kind === "dup" ? "&" : ">");
      if (tok.spec.kind === "dup") cmd.redirs.push({ kind: "dup", fd: tok.spec.fd, toFd: tok.spec.toFd });
      else if (tok.spec.kind === "file") pending = { kind: "file", fd: tok.spec.fd, op: tok.spec.op };
      else pending = { kind: "both", fd: 1, op: tok.spec.op };
      continue;
    }
    if (pending) return syntaxError(tok.value);

    if (tok.value === "|") {
      if (cmdEmpty()) return syntaxError("|");
      pushCmd();
      continue;
    }
    if (cmdEmpty() && pipeline.length === 0) return syntaxError(tok.value);
    pushCmd();
    statements.push({ connector, pipeline });
    pipeline = [];
    connector = tok.value;
  }

  if (pending) return syntaxError("newline");
  if (!cmdEmpty()) {
    pushCmd();
    statements.push({ connector, pipeline });
  } else if (pipeline.length > 0) {
    return syntaxError("newline");
  } else if (statements.length > 0 && connector !== ";") {
    return syntaxError("newline");
  }
  return { statements };
}

export function parse(line: string, env: ParseEnv): ParseResult {
  const t = tokenize(line, env);
  if (t.error) return { statements: [], error: t.error };
  return buildStatements(t.tokens);
}

// Tokenize a string to its words only (operators dropped), for one level of
// alias substitution. Returns [] on a tokenizing error.
export function tokenizeWords(line: string, env: ParseEnv): Word[] {
  const t = tokenize(line, env);
  if (t.error) return [];
  return t.tokens
    .filter((x): x is { kind: "word"; word: Word } => x.kind === "word")
    .map((x) => x.word);
}
