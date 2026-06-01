// Shared C-style backslash-escape decoding for the echo and printf builtins.
// Decodes the escape starting at s[i] (which must be "\\"), returning the
// decoded text and how many source characters it spans, so callers can both
// emit the text and advance their cursor from one result. Unknown escapes are
// returned verbatim (backslash + char). echo's \c (stop output) is handled by
// that caller before decoding, since printf treats \c literally.

export function decodeEscape(s: string, i: number): { text: string; len: number } {
  const c = s[i + 1];
  if (c === undefined) return { text: "\\", len: 1 };
  switch (c) {
    case "n": return { text: "\n", len: 2 };
    case "t": return { text: "\t", len: 2 };
    case "r": return { text: "\r", len: 2 };
    case "a": return { text: "\x07", len: 2 };
    case "b": return { text: "\b", len: 2 };
    case "f": return { text: "\f", len: 2 };
    case "v": return { text: "\v", len: 2 };
    case "\\": return { text: "\\", len: 2 };
    case "0": {
      // \0 then up to three octal digits.
      let oct = "";
      while (oct.length < 3 && /[0-7]/.test(s[i + 2 + oct.length] ?? "")) oct += s[i + 2 + oct.length];
      return { text: String.fromCharCode(oct ? parseInt(oct, 8) : 0), len: 2 + oct.length };
    }
    default: return { text: `\\${c}`, len: 2 };
  }
}
