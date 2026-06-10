import { describe, it, expect } from "vitest";
import { buildFs, formatDate, formatMode, globToRegExp, splitLines, SESSION_MTIME, type FsNode } from "./vfs";
import { TEST_DATA } from "./testkit";

const vfs = buildFs(TEST_DATA);

// Read a node's lines, narrowing the FsNode union (DirNode has no content).
const content = (node: FsNode | undefined): string[] =>
  node && node.kind === "file" ? node.content() : [];

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

describe("splitLines", () => {
  it("drops the trailing newline's empty element", () => {
    expect(splitLines("hi\n")).toEqual(["hi"]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("no-newline")).toEqual(["no-newline"]);
  });
  it("strips a trailing carriage return per line", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
  });
});

describe("session write API", () => {
  it("writeFile creates a file with content-derived size and SESSION_MTIME", () => {
    const fs = buildFs(TEST_DATA);
    expect(fs.writeFile("/home/me/f", "hello\n")).toBeUndefined();
    const node = fs.lookup("/home/me/f");
    expect(node?.kind).toBe("file");
    expect(content(node)).toEqual(["hello"]);
    expect(node?.size).toBe(6);
    expect(node?.mtime).toBe(SESSION_MTIME);
  });
  it("writeFile append concatenates", () => {
    const fs = buildFs(TEST_DATA);
    fs.writeFile("/home/me/f", "a\n");
    fs.writeFile("/home/me/f", "b\n", { append: true });
    expect(content(fs.lookup("/home/me/f"))).toEqual(["a", "b"]);
  });
  it("writeFile reports bash-style structural errors", () => {
    const fs = buildFs(TEST_DATA);
    expect(fs.writeFile("/home/me/posts", "x")).toBe("Is a directory");
    expect(fs.writeFile("/home/me/nodir/f", "x")).toBe("No such file or directory");
  });
  it("mkdir and mkdir -p", () => {
    const fs = buildFs(TEST_DATA);
    expect(fs.mkdir("/home/me/a")).toBeUndefined();
    expect(fs.mkdir("/home/me/a")).toBe("File exists");
    expect(fs.mkdir("/home/me/x/y/z", { parents: true })).toBeUndefined();
    expect(fs.lookup("/home/me/x/y/z")?.kind).toBe("dir");
  });
  it("removePath honors recursive and dirOnly", () => {
    const fs = buildFs(TEST_DATA);
    fs.mkdir("/home/me/d");
    fs.writeFile("/home/me/d/f", "x");
    expect(fs.removePath("/home/me/d", { dirOnly: true })).toBe("Directory not empty");
    expect(fs.removePath("/home/me/d")).toBe("Is a directory");
    expect(fs.removePath("/home/me/d", { recursive: true })).toBeUndefined();
    expect(fs.lookup("/home/me/d")).toBeUndefined();
  });
  it("copy deep-clones so the source and copy are independent", () => {
    const fs = buildFs(TEST_DATA);
    fs.mkdir("/home/me/src");
    fs.writeFile("/home/me/src/a", "one\n");
    expect(fs.copy("/home/me/src", "/home/me/dst", { recursive: true })).toBeUndefined();
    fs.writeFile("/home/me/src/a", "two\n");
    expect(content(fs.lookup("/home/me/dst/a"))).toEqual(["one"]);
  });
  it("move relinks under an existing directory", () => {
    const fs = buildFs(TEST_DATA);
    fs.writeFile("/home/me/a", "x\n");
    fs.mkdir("/home/me/d");
    expect(fs.move("/home/me/a", "/home/me/d")).toBeUndefined();
    expect(fs.lookup("/home/me/a")).toBeUndefined();
    expect(fs.lookup("/home/me/d/a")?.kind).toBe("file");
  });
  it("copy and move refuse a target that resolves to the source", () => {
    const fs = buildFs(TEST_DATA);
    fs.writeFile("/home/me/f", "x\n");
    expect(fs.copy("/home/me/f", "/home/me/f")).toBe("same file");
    expect(fs.move("/home/me/f", "/home/me/f")).toBe("same file");
    // dst spelled as the containing directory resolves to the same path
    expect(fs.move("/home/me/f", "/home/me")).toBe("same file");
    expect(content(fs.lookup("/home/me/f"))).toEqual(["x"]); // no mutation
  });
  it("move refuses to relocate a directory into its own subtree", () => {
    const fs = buildFs(TEST_DATA);
    fs.mkdir("/home/me/d");
    fs.writeFile("/home/me/d/f", "keep\n");
    // dst is the dir itself (target d/d) or an explicit path under it
    expect(fs.move("/home/me/d", "/home/me/d")).toBe("into itself");
    expect(fs.move("/home/me/d", "/home/me/d/x")).toBe("into itself");
    // the subtree never detached into a self-cycle
    expect(content(fs.lookup("/home/me/d/f"))).toEqual(["keep"]);
  });
  it("copy refuses to copy a directory into its own subtree", () => {
    const fs = buildFs(TEST_DATA);
    fs.mkdir("/home/me/d");
    expect(fs.copy("/home/me/d", "/home/me/d", { recursive: true })).toBe("into itself");
    expect(fs.lookup("/home/me/d/d")).toBeUndefined(); // nothing was created
  });
  it("the subtree guard applies only to directory sources", () => {
    const fs = buildFs(TEST_DATA);
    fs.writeFile("/home/me/f", "x\n");
    // a path "under" a file fails the parent walk, as in GNU mv
    expect(fs.move("/home/me/f", "/home/me/f/x")).toBe("No such file or directory");
  });
  it("a missing target parent wins over the subtree guard", () => {
    // GNU reports ENOENT before the into-itself diagnostic
    const fs = buildFs(TEST_DATA);
    fs.mkdir("/home/me/d");
    expect(fs.move("/home/me/d", "/home/me/d/nope/x")).toBe("No such file or directory");
    expect(fs.copy("/home/me/d", "/home/me/d/nope/x", { recursive: true })).toBe("No such file or directory");
  });
  it("touch creates an empty file and is a no-op when it exists", () => {
    const fs = buildFs(TEST_DATA);
    expect(fs.touch("/home/me/t")).toBeUndefined();
    expect(content(fs.lookup("/home/me/t"))).toEqual([]);
    expect(fs.touch("/home/me/t")).toBeUndefined();
  });
});
