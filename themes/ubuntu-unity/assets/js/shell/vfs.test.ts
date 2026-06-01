import { describe, it, expect } from "vitest";
import { buildFs, formatDate, formatMode, globToRegExp } from "./vfs";
import { TEST_DATA } from "./testkit";

const vfs = buildFs(TEST_DATA);

describe("path resolution", () => {
  it("resolves relative, absolute, and ~ paths", () => {
    expect(vfs.resolvePath("/home/me", "posts")).toBe("/home/me/posts");
    expect(vfs.resolvePath("/home/me/posts", "..")).toBe("/home/me");
    expect(vfs.resolvePath("/home/me", "/etc")).toBe("/etc");
    expect(vfs.resolvePath("/home/me/posts", "~")).toBe("/home/me");
    expect(vfs.resolvePath("/anywhere", "~/posts")).toBe("/home/me/posts");
  });
  it("never pops past root", () => {
    expect(vfs.resolvePath("/", "../../x")).toBe("/x");
  });
  it("drops . and empty segments", () => {
    expect(vfs.resolvePath("/home/me", "./a//b/")).toBe("/home/me/a/b");
  });
});

describe("lookup", () => {
  it("finds directories and files", () => {
    expect(vfs.lookup("/home/me")?.kind).toBe("dir");
    expect(vfs.lookup("/home/me/README.md")?.kind).toBe("file");
  });
  it("returns undefined for missing paths and for descent into a file", () => {
    expect(vfs.lookup("/home/me/nope")).toBeUndefined();
    expect(vfs.lookup("/home/me/README.md/x")).toBeUndefined();
  });
});

describe("displayPath", () => {
  it("collapses home to ~", () => {
    expect(vfs.displayPath("/home/me")).toBe("~");
    expect(vfs.displayPath("/home/me/posts")).toBe("~/posts");
    expect(vfs.displayPath("/etc")).toBe("/etc");
  });
});

describe("formatting helpers", () => {
  it("formats modes", () => {
    expect(formatMode(vfs.lookup("/home/me")!)).toBe("drwxr-xr-x");
    expect(formatMode(vfs.lookup("/home/me/README.md")!)).toBe("-rw-r--r--");
  });
  it("formats dates", () => {
    expect(formatDate("2024-01-01")).toBe("Jan  1  2024");
    expect(formatDate("2024-12-25")).toBe("Dec 25  2024");
  });
});

describe("globToRegExp", () => {
  it("translates * ? and classes", () => {
    expect(globToRegExp("*.md").test("a.md")).toBe(true);
    expect(globToRegExp("a?.md").test("ab.md")).toBe(true);
    expect(globToRegExp("a?.md").test("abc.md")).toBe(false);
    expect(globToRegExp("[Rp]*").test("README")).toBe(true);
    expect(globToRegExp("[!a]x").test("bx")).toBe(true);
    expect(globToRegExp("[!a]x").test("ax")).toBe(false);
  });
  it("applies the leading-dot rule only when asked", () => {
    expect(globToRegExp("*", { leadingDot: true }).test(".hidden")).toBe(false);
    expect(globToRegExp("*").test(".hidden")).toBe(true);
  });
});
