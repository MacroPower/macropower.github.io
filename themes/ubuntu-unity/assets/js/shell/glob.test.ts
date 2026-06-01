// Filename globbing against the VFS fixture. Not bash-diffed: bash would need
// matching real files on disk, and its dotfile glob also yields . and .. which
// the VFS has no entries for. These are JS-only golden assertions.

import { describe, it, expect } from "vitest";
import { buildFs } from "./vfs";
import { TEST_DATA, makeShell } from "./testkit";

const vfs = buildFs(TEST_DATA);
const HOME = "/home/me";

describe("Vfs.glob", () => {
  it("matches *.md in home, sorted", () => {
    expect(vfs.glob(HOME, "*.md")).toEqual(["README.md", "cv.md"]);
  });
  it("matches all non-dot entries with *", () => {
    expect(vfs.glob(HOME, "*")).toEqual(["README.md", "about.txt", "cv.md", "posts", "projects"]);
  });
  it("descends path segments", () => {
    expect(vfs.glob(HOME, "posts/*")).toEqual(["posts/hello-world.md", "posts/second-post.md"]);
  });
  it("honors ? as a single character", () => {
    expect(vfs.glob(HOME, "??.md")).toEqual(["cv.md"]);
    expect(vfs.glob(HOME, "a?.md")).toEqual([]);
  });
  it("honors character classes", () => {
    expect(vfs.glob(HOME, "[Rp]*")).toEqual(["README.md", "posts", "projects"]);
  });
  it("preserves the input shape for absolute patterns", () => {
    expect(vfs.glob(HOME, "/etc/*")).toEqual(["/etc/motd"]);
  });
  it("excludes dotfiles unless the pattern starts with a dot", () => {
    expect(vfs.glob(HOME, "*")).not.toContain(".bashrc");
    expect(vfs.glob(HOME, ".*")).toEqual([".bashrc", ".social"]);
  });
});

describe("globbing through the shell", () => {
  it("expands an unquoted * for echo", () => {
    expect(makeShell().run("echo *.md").stdout).toBe("README.md cv.md\n");
  });
  it("keeps a non-matching pattern literal (nullglob off)", () => {
    expect(makeShell().run("echo a?.md").stdout).toBe("a?.md\n");
  });
  it("does not glob a quoted metacharacter", () => {
    expect(makeShell().run("echo '*.md'").stdout).toBe("*.md\n");
  });
  it("does not glob a metacharacter produced by expansion", () => {
    // Documented divergence from bash: only unquoted literal metacharacters
    // trigger globbing.
    expect(makeShell().run("x='*.md'; echo $x").stdout).toBe("*.md\n");
  });
});
