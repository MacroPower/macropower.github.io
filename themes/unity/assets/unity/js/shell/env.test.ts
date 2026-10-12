import { describe, it, expect } from "vitest";
import { Env } from "./env";
import { makeShell } from "./testkit";

describe("Env store", () => {
  it("gets and sets, tracking exports", () => {
    const e = new Env({ status: () => 0 });
    e.set("A", "1");
    e.set("B", "2", { export: true });
    expect(e.get("A")).toBe("1");
    expect(e.isExported("A")).toBe(false);
    expect(e.isExported("B")).toBe(true);
    expect(e.exports()).toEqual([["B", "2"]]);
  });

  it("distinguishes unset from null via isSet", () => {
    const e = new Env({ status: () => 0 });
    e.set("EMPTY", "");
    expect(e.isSet("EMPTY")).toBe(true);
    expect(e.isSet("MISSING")).toBe(false);
    expect(e.isSet("?")).toBe(true); // special params are always set
  });

  it("looks up special parameters", () => {
    const e = new Env({ status: () => 7 });
    expect(e.lookup("?")).toBe("7");
    expect(Number(e.lookup("$"))).toBeGreaterThan(0);
    expect(e.lookup("MISSING")).toBe("");
  });

  it("snapshots and restores the full state", () => {
    const e = new Env({ status: () => 0 });
    e.set("KEEP", "a", { export: true });
    const snap = e.snapshot();
    e.set("KEEP", "b");
    e.set("NEW", "c");
    e.unset("KEEP");
    e.restore(snap);
    expect(e.get("KEEP")).toBe("a");
    expect(e.isExported("KEEP")).toBe(true);
    expect(e.get("NEW")).toBeUndefined();
  });
});

describe("env via the shell", () => {
  it("reads $? after success and failure", () => {
    const sh = makeShell();
    expect(sh.run("true; echo $?").stdout).toBe("0\n");
    expect(sh.run("false; echo $?").stdout).toBe("1\n");
  });
  it("applies same-line assignments to later expansions", () => {
    const sh = makeShell();
    expect(sh.run("X=hello; echo $X").stdout).toBe("hello\n");
  });
  it("persists assignments across lines (one shell)", () => {
    const sh = makeShell();
    sh.run("FOO=bar");
    expect(sh.run("echo $FOO").stdout).toBe("bar\n");
  });
  it("short-circuits && and ||", () => {
    const sh = makeShell();
    expect(sh.run("true && echo a").stdout).toBe("a\n");
    expect(sh.run("false && echo a").stdout).toBe("");
    expect(sh.run("false || echo b").stdout).toBe("b\n");
  });
});
