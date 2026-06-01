// Command-line parser for the home terminal: turns a raw input line into a list
// of statements (separated by ; && ||), each a pipeline of simple commands
// (separated by |) with optional > / >> redirection. Pure and DOM-free.
//
// Quotes, escapes, and ~ are resolved at parse time, but $ parameters are left
// as unresolved parts and expanded by the shell just before a command runs --
// so $? and variables assigned earlier on the same line read the live value.
// Quoting gates expansion the way a real shell does: a parameter inside single
// quotes is literal; everywhere else it expands. Word splitting is not applied
// to expansion results, which keeps the toy predictable.

// Source for tilde expansion (resolved while parsing).
export interface ParseEnv {
  home: string;
}

// Source for parameter expansion (applied at run time).
export interface ExpandEnv {
  lookup(name: string): string;
}

export type Operator = "|" | "&&" | "||" | ";" | ">" | ">>";
export type Connector = ";" | "&&" | "||";

export type WordPart = { lit: string } | { param: string };

export interface Word {
  parts: WordPart[];
  /** True if any part originated inside quotes (gates null-word removal). */
  quoted: boolean;
}

export interface Redirect {
  op: ">" | ">>";
  target: Word;
}

export interface SimpleCommand {
  words: Word[];
  redir: Redirect | null;
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

type Token =
  | { kind: "word"; word: Word }
  | { kind: "op"; value: Operator };

const WORD_CHAR = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

/** Concatenate a word's parts, expanding parameters through `env`. */
export function expandWord(word: Word, env: ExpandEnv): string {
  let out = "";
  for (const p of word.parts) out += "lit" in p ? p.lit : env.lookup(p.param);
  return out;
}

// A word is a "null word" (dropped from argv, as in bash) when an unquoted
// expansion yields nothing and the word contributed no literal text -- e.g. a
// bare $UNSET. Quoted empties ("") and partial words (a$UNSET -> "a") survive.
export function isNullWord(word: Word, value: string): boolean {
  return value === "" && !word.quoted && word.parts.length > 0
    && word.parts.every((p) => "param" in p);
}

// Read a `$...` reference at index i (line[i] === "$"); return the part it
// yields (a parameter, or a literal "$" when it is not a real reference) and
// the index just past it.
function readParam(line: string, i: number): { part: WordPart; next: number } {
  const j = i + 1;
  const c = line[j];
  if (c === "{") {
    let k = j + 1;
    let name = "";
    while (k < line.length && line[k] !== "}") { name += line[k]; k += 1; }
    if (line[k] !== "}") return { part: { lit: `\${${name}` }, next: line.length };
    return { part: { param: name }, next: k + 1 };
  }
  if (c !== undefined && "?$#!*@-".includes(c)) return { part: { param: c }, next: j + 1 };
  if (c !== undefined && WORD_CHAR.test(c)) {
    let k = j;
    let name = "";
    while (k < line.length && NAME_CHAR.test(line[k] ?? "")) { name += line[k]; k += 1; }
    return { part: { param: name }, next: k };
  }
  if (c !== undefined && /[0-9]/.test(c)) {
    // Positional parameters expand to empty interactively.
    let k = j;
    while (k < line.length && /[0-9]/.test(line[k] ?? "")) k += 1;
    return { part: { param: line.slice(j, k) }, next: k };
  }
  return { part: { lit: "$" }, next: j };
}

function tokenize(line: string, env: ParseEnv): { tokens: Token[]; error?: string } {
  const tokens: Token[] = [];
  let parts: WordPart[] = [];
  let lit = "";
  let started = false;
  let quoted = false;

  const flushLit = (): void => { if (lit) { parts.push({ lit }); lit = ""; } };
  const flushWord = (): void => {
    if (!started) return;
    flushLit();
    tokens.push({ kind: "word", word: { parts, quoted } });
    parts = [];
    quoted = false;
    started = false;
  };
  const op = (value: Operator): void => { tokens.push({ kind: "op", value }); };
  const param = (line2: string, idx: number): number => {
    const r = readParam(line2, idx);
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
    if (c === "&") { flushWord(); if (line[i + 1] === "&") { op("&&"); i += 2; } else { op(";"); i += 1; } continue; }
    if (c === ";") { flushWord(); op(";"); i += 1; continue; }
    if (c === ">") { flushWord(); if (line[i + 1] === ">") { op(">>"); i += 2; } else { op(">"); i += 1; } continue; }

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
        if (d === "$") { i = param(line, i); continue; }
        lit += d; i += 1;
      }
      if (i >= n) return { tokens: [], error: 'unexpected EOF while looking for matching `"\'' };
      i += 1;
      continue;
    }
    if (c === "\\") { if (i + 1 < n) { lit += line[i + 1]; i += 2; } else { i += 1; } continue; }
    if (c === "$") { i = param(line, i); continue; }
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
  let cmd: SimpleCommand = { words: [], redir: null };
  let connector: Connector = ";";
  let pendingRedir: ">" | ">>" | null = null;

  const cmdEmpty = (): boolean => cmd.words.length === 0 && !cmd.redir;
  const pushCmd = (): void => { pipeline.push(cmd); cmd = { words: [], redir: null }; };

  for (const tok of tokens) {
    if (tok.kind === "word") {
      if (pendingRedir) { cmd.redir = { op: pendingRedir, target: tok.word }; pendingRedir = null; }
      else cmd.words.push(tok.word);
      continue;
    }
    if (pendingRedir) return syntaxError(tok.value);

    if (tok.value === ">" || tok.value === ">>") { pendingRedir = tok.value; continue; }
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

  if (pendingRedir) return syntaxError("newline");
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
