import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

// main.css without its comments.
const css = readFileSync(join(here, "..", "css", "main.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Splits a selector list at its top-level commas.
function splitList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out;
}

interface Rule {
  selector: string;
  // The at-rules around the rule, joined, such as "@media print".
  media: string;
  decls: Map<string, string>;
}

// Every rule in source order, one entry per selector, with nesting
// resolved, so `.up-tl { &::after {} }` yields ".up-tl::after".
const rules: Rule[] = [];
{
  const open: { selectors: string[]; media: string }[] = [];
  const own: Map<string, string>[] = [];
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c !== "{" && c !== ";" && c !== "}") continue;
    const text = css.slice(start, i).trim().replace(/\s+/g, " ");
    start = i + 1;
    if (c === "{") {
      const parents = open.at(-1)?.selectors ?? [];
      let media = open.at(-1)?.media ?? "";
      let selectors: string[];
      if (text.startsWith("@")) {
        selectors = parents;
        media = `${media} ${text}`.trim();
      } else if (parents.length === 0) selectors = splitList(text);
      else {
        selectors = parents.flatMap((p) =>
          splitList(text).map((s) => (s.includes("&") ? s.replaceAll("&", p) : `${p} ${s}`)));
      }
      const decls = new Map<string, string>();
      open.push({ selectors, media });
      own.push(decls);
      for (const selector of selectors) rules.push({ selector, media, decls });
      continue;
    }
    const m = /^([\w-]+)\s*:([\s\S]+)$/.exec(text);
    if (m) own.at(-1)?.set(m[1]!, m[2]!.trim());
    if (c === "}") {
      open.pop();
      own.pop();
    }
  }
}

// The rules that size and stack the titlebar's beads.
const WATCHED = [
  ".up-titlebar",
  ".up-titlebar-text",
  ".up-tl-group",
  ".up-tl",
  ".up-tl::after",
  ".up-resize-handle",
];

// The value that wins for a selector in a media context: the last
// declaration among the unconditional rules and the context's own.
function value(ctx: string, selector: string, prop: string): string | undefined {
  let v: string | undefined;
  for (const r of rules) {
    if (r.selector !== selector || (r.media !== "" && r.media !== ctx)) continue;
    v = r.decls.get(prop) ?? v;
  }
  return v;
}

// The default context and every media context with a rule for a watched
// selector, such as a coarse pointer or a narrow viewport. A context that
// hides the titlebar, such as print, has no targets to check.
const contexts = [
  "",
  ...new Set(rules.filter((r) => r.media && WATCHED.includes(r.selector)).map((r) => r.media)),
].filter((ctx) => !value(ctx, ".up-titlebar", "display")?.startsWith("none"));

function px(v: string | undefined, what: string): number {
  const m = /^(-?[\d.]+)px$/.exec(v ?? "");
  if (!m) throw new Error(`${what} is not a px length: ${v}`);
  return Number(m[1]);
}

// Expands a 1 to 4 value box shorthand, such as padding or inset, into
// its top, right, bottom, and left lengths.
function box(v: string | undefined, what: string): [number, number, number, number] {
  const parts = (v ?? "").split(" ").map((p) => (p === "0" ? 0 : px(p, what)));
  const [t = 0, r = t, b = t, l = r] = parts;
  return [t, r, b, l];
}

describe("titlebar bead targets", () => {
  for (const ctx of contexts) {
    const where = ctx || "by default";

    // WCAG 2.2 SC 2.5.8 asks for a 24px square target, or 24px between the
    // centers of smaller ones. Overlapping hit areas do not count, so the
    // beads meet it only when each hit area is 24px square and the hit
    // areas never overlap.
    it(`gives each bead a 24px hit area ${where}`, () => {
      const w = px(value(ctx, ".up-tl", "width"), ".up-tl width");
      const h = px(value(ctx, ".up-tl", "height"), ".up-tl height");
      expect(value(ctx, ".up-tl::after", "content"), ".up-tl::after content").toBe('""');
      expect(value(ctx, ".up-tl::after", "position"), ".up-tl::after position").toBe("absolute");
      const [t, r, b, l] = box(value(ctx, ".up-tl::after", "inset"), ".up-tl::after inset");
      expect(w - l - r, "hit area width").toBeGreaterThanOrEqual(24);
      expect(h - t - b, "hit area height").toBeGreaterThanOrEqual(24);
    });

    it(`keeps the bead hit areas apart ${where}`, () => {
      const w = px(value(ctx, ".up-tl", "width"), ".up-tl width");
      const gap = px(value(ctx, ".up-tl-group", "gap"), ".up-tl-group gap");
      const [, r, , l] = box(value(ctx, ".up-tl::after", "inset"), ".up-tl::after inset");
      expect(w + gap, "center-to-center pitch").toBeGreaterThanOrEqual(w - l - r);
    });

    // The window chrome clips its titlebar, so a hit area that leaves the
    // titlebar loses the part outside it.
    it(`fits each bead's hit area inside the titlebar ${where}`, () => {
      const h = px(value(ctx, ".up-tl", "height"), ".up-tl height");
      const [t, r, b, l] = box(value(ctx, ".up-tl::after", "inset"), ".up-tl::after inset");
      const height = px(value(ctx, ".up-titlebar", "height"), ".up-titlebar height");
      const border = px(value(ctx, ".up-titlebar", "border-bottom")?.split(" ")[0], ".up-titlebar border-bottom");
      expect(h - t - b, "hit area height").toBeLessThanOrEqual(height - border);
      // The beads sit at the titlebar's start edge, which is the right
      // edge on a right-to-left page.
      const pad = px(value(ctx, ".up-titlebar", "padding-inline")?.split(" ")[0], ".up-titlebar padding-inline");
      expect(Math.max(-l, -r), "hit area outset at the start edge").toBeLessThanOrEqual(pad);
    });

    // resize.ts lays its zones over the window's edges, and the top and
    // left zones cross the beads' hit areas.
    it(`stacks the beads above the resize zones ${where}`, () => {
      expect(value(ctx, ".up-tl", "position"), ".up-tl position").toMatch(/^(relative|absolute)$/);
      const bead = Number(value(ctx, ".up-tl", "z-index"));
      const zone = Number(value(ctx, ".up-resize-handle", "z-index"));
      expect(bead, ".up-tl z-index").toBeGreaterThan(zone);
    });

    // The title's end margin balances a three-bead group, so a change to
    // the bead pitch must move the margin with it.
    it(`centers the title against a three-bead group ${where}`, () => {
      const w = px(value(ctx, ".up-tl", "width"), ".up-tl width");
      const gap = px(value(ctx, ".up-tl-group", "gap"), ".up-tl-group gap");
      const margin = px(value(ctx, ".up-tl-group", "margin-inline-end"), ".up-tl-group margin-inline-end");
      const title = px(value(ctx, ".up-titlebar-text", "margin-inline-end"), ".up-titlebar-text margin-inline-end");
      expect(title).toBe(3 * w + 2 * gap + margin);
    });
  }
});
