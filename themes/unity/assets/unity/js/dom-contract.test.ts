// Scripts find their nodes by data-* attributes and up- classes, and tsc
// cannot check that a template, an icon, or a script writes each one. This
// suite collects every name that a script reads and fails when nothing
// writes it. A rename on the writing side then fails here instead of
// breaking a script silently. A name that another template still writes
// passes, so a rename still calls for a grep of the scripts.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const theme = join(here, "..", "..", "..");

// A string literal, or one static part of a template literal.
interface Literal {
  text: string;
  /** The literal's offset in the source. */
  at: number;
  /** The function that the innermost open parenthesis around it calls, or "". */
  callee: string;
  /** Whether a ${} substitution follows the text directly. */
  open: boolean;
}

interface Lexed {
  literals: Literal[];
  /** The source with every comment, literal, and regex body blanked to spaces. */
  code: string;
  /** Whether every bracket closed. A balanced script shows that the lexer
   *  read each comment, literal, and regex whole. */
  balanced: boolean;
}

// Words after which a slash starts a regex rather than a division.
const REGEX_AFTER = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);
// Words that a parenthesis follows without calling them.
const NOT_CALLS = new Set(["if", "for", "while", "switch", "catch", "function", ...REGEX_AFTER]);

// Splits a script into its literals and the code around them. It tracks
// only what the scan needs: comments, string and template literals,
// regexes, and the call that each literal sits in.
function lex(src: string): Lexed {
  const literals: Literal[] = [];
  const calls: string[] = [];
  // One entry per open brace, true for the brace that opens a ${} substitution.
  const braces: boolean[] = [];
  let code = "";
  let closed = true;
  let i = 0;
  const blank = (from: number, to: number): void => {
    code += src.slice(from, to).replace(/[^\n]/g, " ");
  };
  const callee = (): string => calls[calls.length - 1] ?? "";
  // A slash starts a regex after an operator, an opening bracket, or a
  // keyword, and divides after a value. A "!" right after a value is
  // TypeScript's non-null assertion, so a value ends there too.
  const startsRegex = (): boolean => {
    let j = code.length - 1;
    while (j >= 0 && /\s/.test(code[j]!)) j--;
    if (j < 0) return true;
    const c = code[j]!;
    if (c === ")" || c === "]") return false;
    if (c === "!") return !/[\w$)\]]/.test(code[j - 1] ?? "");
    if (!/[\w$]/.test(c)) return true;
    let k = j;
    while (k > 0 && /[\w$]/.test(code[k - 1]!)) k--;
    return REGEX_AFTER.has(code.slice(k, j + 1));
  };
  // Reads a template literal's next static part. i sits just past the
  // backtick or the brace that closed the last substitution.
  const template = (): void => {
    const start = i;
    while (i < src.length) {
      const c = src[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      const sub = c === "$" && src[i + 1] === "{";
      if (c === "`" || sub) {
        literals.push({ text: src.slice(start, i), at: start, callee: callee(), open: sub });
        blank(start, i);
        code += sub ? "${" : "`";
        i += sub ? 2 : 1;
        if (sub) braces.push(true);
        return;
      }
      i++;
    }
    closed = false;
    blank(start, i);
  };
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && (next === "/" || next === "*")) {
      const end = next === "/" ? src.indexOf("\n", i) : src.indexOf("*/", i + 2);
      if (end === -1 && next === "*") closed = false;
      const stop = end === -1 ? src.length : next === "/" ? end : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      if (src[j] !== c) closed = false;
      literals.push({ text: src.slice(i + 1, j), at: i, callee: callee(), open: false });
      code += c;
      blank(i + 1, j);
      code += src[j] ?? "";
      i = j + 1;
    } else if (c === "`") {
      code += c;
      i++;
      template();
    } else if (c === "/" && startsRegex()) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n" && (inClass || src[j] !== "/")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j++;
      }
      if (src[j] !== "/") closed = false;
      code += c;
      blank(i + 1, j);
      code += src[j] ?? "";
      i = j + 1;
    } else if (c === "}" && braces[braces.length - 1]) {
      braces.pop();
      code += c;
      i++;
      template();
    } else {
      if (c === "(") {
        const m = /([\w$]+)\s*(?:<[^()]*>)?\s*(?:\?\.)?\s*$/.exec(code.slice(-120));
        calls.push(m && !NOT_CALLS.has(m[1]!) ? m[1]! : "");
      } else if (c === ")") {
        if (calls.pop() === undefined) closed = false;
      } else if (c === "{") {
        braces.push(false);
      } else if (c === "}") {
        if (braces.pop() === undefined) closed = false;
      }
      code += c;
      i++;
    }
  }
  return { literals, code, balanced: closed && calls.length === 0 && braces.length === 0 };
}

interface Names {
  /** Each name a script reads, with the file and line of every read. */
  reads: Map<string, string[]>;
  /** Each name a script writes. */
  writes: Set<string>;
  /** Names that a ${} substitution completes, so the scan cannot read them in full. */
  partial: string[];
  /** The files whose brackets did not balance. */
  unbalanced: string[];
}

// Calls whose literal argument names an attribute, a class, or an id
// without reading or writing it.
const NEITHER = new Set(["removeAttribute", "remove", "getElementById"]);

// Collects the names that the scripts read and write.
//
// A selector reads the data-* name after "[" and the up- name after ".".
// Scripts read classes outside a selector only through classList.contains
// and set them in many ways, such as className, classList, and tables of
// names. So every other up- name in a literal counts as a write. A script
// writes a data-* name through setAttribute, toggleAttribute, a dataset
// assignment, or markup it builds. Every other data-* name in a literal
// counts as a read, such as one that a variable carries to getAttribute.
// A const that holds an element's dataset stands for the dataset in the
// rest of its file.
function names(files: readonly { name: string; text: string }[]): Names {
  const found: Names = { reads: new Map(), writes: new Set(), partial: [], unbalanced: [] };
  for (const { name, text } of files) {
    const { literals, code, balanced } = lex(text);
    if (!balanced) found.unbalanced.push(name);
    const where = (at: number): string => `${name}:${text.slice(0, at).split("\n").length}`;
    const read = (key: string, at: number): void => {
      found.reads.set(key, [...(found.reads.get(key) ?? []), where(at)]);
    };
    for (const lit of literals) {
      const cut = (m: RegExpExecArray): boolean => lit.open && m.index + m[0].length === lit.text.length;
      for (const m of lit.text.matchAll(/\[\s*(data-[\w-]*)|\.(up-[\w-]*)/g)) {
        if (cut(m)) found.partial.push(`${where(lit.at)}: ${m[0]}`);
        else read((m[1] ?? m[2])!, lit.at);
      }
      if (NEITHER.has(lit.callee)) continue;
      for (const m of lit.text.matchAll(/(?<![\w$.[#/-])(data|up)-[\w-]+/g)) {
        const write = m[1] === "up"
          ? lit.callee !== "contains"
          : lit.callee === "setAttribute" || lit.callee === "toggleAttribute" || lit.text.includes("<");
        if (write) found.writes.add(m[0]);
        else if (cut(m)) found.partial.push(`${where(lit.at)}: ${m[0]}`);
        else read(m[0], lit.at);
      }
    }
    const aliases = [...code.matchAll(/\b(?:const|let)\s+([\w$]+)\s*=\s*[\w$.?]+\.dataset\s*;/g)].map((m) => m[1]!);
    const owner = ["\\.dataset", ...aliases.map((a) => `(?<![\\w$.])${a.replace(/\$/g, "\\$")}`)].join("|");
    const access = new RegExp(`(?:${owner})\\??\\.([\\w$]+)(\\s*(?:\\?\\?|\\|\\||&&)?=(?!=))?`, "g");
    for (const m of code.matchAll(access)) {
      const key = `data-${m[1]!.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      if (m[2]) found.writes.add(key);
      else read(key, m.index);
    }
  }
  return found;
}

// The theme's non-test scripts, by path under assets/unity/js.
function scripts(): { name: string; text: string }[] {
  return readdirSync(here, { encoding: "utf8", recursive: true })
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
    .map((f) => ({ name: f, text: readFileSync(join(here, f), "utf8") }));
}

// The theme's templates and icons as one text, without their comments.
function markup(): string {
  const under = (dir: string, ext: RegExp): string[] =>
    readdirSync(join(theme, dir), { encoding: "utf8", recursive: true })
      .filter((f) => ext.test(f))
      .map((f) => readFileSync(join(theme, dir, f), "utf8"));
  return [...under("layouts", /\.(html|xml|txt)$/), ...under(join("assets", "unity", "icons"), /\.svg$/)]
    .map((text) => text.replace(/\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g, "").replace(/<!--[\s\S]*?-->/g, ""))
    .join("\n");
}

describe("DOM contract", () => {
  const found = names(scripts());
  const written = markup();
  const emitted = (name: string): boolean =>
    found.writes.has(name) || new RegExp(`(?<![\\w$.[#/-])${name}(?![\\w-])`).test(written);

  it("lexes every script to balanced brackets", () => {
    expect(found.unbalanced).toEqual([]);
  });

  it("names each attribute and class in full", () => {
    expect(found.partial).toEqual([]);
  });

  it("writes every attribute and class that a script reads", () => {
    expect(found.reads.size).toBeGreaterThan(0);
    const missing = [...found.reads].filter(([name]) => !emitted(name)).map(([name, at]) => `${name} (${at.join(", ")})`);
    expect(missing).toEqual([]);
  });
});

describe("names", () => {
  const fixture = [
    '// root.querySelector("[data-line-comment]");',
    "/* .up-block-comment */",
    'const re = /"[data-regex]/g;',
    'const half = widths[i]! / 2; const sel = "[data-after-division]";',
    'root.querySelector<HTMLElement>(`[data-template="${id}"] .up-template`);',
    "root.querySelector(`[data-partial-${id}], [data-${name}]`);",
    'el.setAttribute("data-set", ""); el.toggleAttribute("data-toggled", on);',
    'el.innerHTML = `<b class="up-markup" data-markup>${x}</b>`;',
    'el.className = "up-assigned"; el.classList.add("up-added");',
    'el.dataset.fooBar = "1"; if (el.dataset.bazQux) use(el.dataset.quux ??= "1");',
    "const d = tile.dataset; use(d.aliased);",
    'el.getAttribute("data-got"); el.hasAttribute(on ? "data-has" : "data-has-not");',
    'const attr = "data-variable"; el.getAttribute(attr);',
    'document.body.classList.contains("up-checked");',
    'el.removeAttribute("data-removed"); el.classList.remove("up-removed"); document.getElementById("up-by-id");',
  ].join("\n");
  const found = names([{ name: "fixture.ts", text: fixture }]);

  it("lexes the fixture to balanced brackets", () => {
    expect(found.unbalanced).toEqual([]);
  });

  it("reads selectors, attribute reads, contains, and dataset reads, but not comments or regexes", () => {
    expect([...found.reads.keys()].sort()).toEqual([
      "data-after-division", "data-aliased", "data-baz-qux", "data-got", "data-has", "data-has-not",
      "data-template", "data-variable", "up-checked", "up-template",
    ]);
    expect(found.reads.get("data-template")).toEqual(["fixture.ts:5"]);
  });

  it("writes attributes, classes, markup, and dataset assignments", () => {
    expect([...found.writes].sort()).toEqual([
      "data-foo-bar", "data-markup", "data-quux", "data-set", "data-toggled", "up-added", "up-assigned", "up-markup",
    ]);
  });

  it("reports a selector name that a substitution completes", () => {
    expect(found.partial).toEqual(["fixture.ts:6: [data-partial-", "fixture.ts:6: [data-"]);
  });
});
