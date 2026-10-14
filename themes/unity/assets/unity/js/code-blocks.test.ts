import { describe, expect, it } from "vitest";

import { rules } from "./testkit";

const PROSE = ":is(.up-reader-body, .up-page-body)";

// The declarations of every rule for one selector in the Markdown
// bodies outside an at-rule, merged in source order, so a later
// declaration wins.
function decls(selector: string): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const r of rules) {
    if (!r.media && r.selector === `${PROSE} ${selector}`) for (const [prop, value] of r.decls) out.set(prop, value);
  }
  return out;
}

// With lineNos = "table", Hugo lays out a highlighted block as a table
// in a div. Each cell holds a pre, one for the line numbers and one for
// the code. The selectors name elements instead of Hugo's lntable and
// lntd classes, because Hugo's default style attributes leave the
// classes out.
describe("a code block with a line number table", () => {
  it("draws the plain block's border and padding once, around the table", () => {
    const pre = decls("pre");
    const box = decls(".highlight div:has(> table)");
    const props = ["border", "border-radius", "padding", "overflow"];
    expect(props.map((p) => box.get(p))).toEqual(props.map((p) => pre.get(p)));
  });

  it("draws no box around the pre in each cell", () => {
    const cell = decls(".highlight td pre");
    expect(["margin", "padding", "border", "border-radius"].map((p) => cell.get(p))).toEqual(["0", "0", "0", "0"]);
  });

  it("spaces the line numbers like the lines of code", () => {
    expect(decls(".highlight td code").get("display")).toBe("block");
  });

  it("sizes the table's text like a plain block's", () => {
    // The prose rules give a Markdown table a smaller font.
    expect(decls("table").get("font-size")).not.toBe("inherit");
    expect(decls(".highlight table").get("font-size")).toBe("inherit");
  });

  it("leaves the colors of the table's div to the highlight style", () => {
    const box = decls(".highlight div:has(> table)");
    expect(["color", "background", "background-color"].filter((p) => box.has(p))).toEqual([]);
  });
});
