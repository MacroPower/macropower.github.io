// Runs Biome with the theme's biome.json over a scratch copy of the source
// tree that holds three small modules, and checks which rules fire. One
// module breaks the two type-aware rules that biome.json turns on, and one
// follows them. The floating call imports its async function from another
// module, like the `dispatchAction()` calls in hud.ts, so the check covers
// Biome's inference across modules. The suite fails when an edit to
// biome.json drops either rule, or when a Biome upgrade stops either rule
// from firing.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const theme = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const biome = createRequire(import.meta.url).resolve("@biomejs/biome/bin/biome");

const FIXTURES: Readonly<Record<string, string>> = {
  "later.ts": `export async function later(): Promise<number> {
  return 1;
}
`,
  "broken.ts": `import { later } from "./later";

export type Mode = "a" | "b";

export function pick(mode: Mode): number {
  switch (mode) {
    case "a":
      return 1;
  }
  return 0;
}

export function go(): void {
  later();
}
`,
  "clean.ts": `import { later } from "./later";

export type Mode = "a" | "b";

export function pick(mode: Mode): number {
  switch (mode) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
}

export function go(): void {
  void later();
}
`,
};

// One line of Biome's GitHub reporter, such as
// `::error title=lint/nursery/noFloatingPromises,file=/x/broken.ts,line=14,...`.
const FINDING = /^::\w+ title=([^,]+),file=([^,]+),line=(\d+),/;

let root = "";

beforeAll(() => {
  // Biome prints real paths, and the temp directory sits behind a symlink
  // on macOS.
  root = realpathSync(mkdtempSync(join(tmpdir(), "unity-lint-")));
  copyFileSync(join(theme, "biome.json"), join(root, "biome.json"));
  const src = join(root, "assets", "unity", "js");
  mkdirSync(src, { recursive: true });
  for (const [name, text] of Object.entries(FIXTURES)) writeFileSync(join(src, name), text);
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("biome.json", () => {
  it("flags floating promises and partial switches", () => {
    // The scratch copy is not a git checkout, so Biome cannot read the
    // .gitignore that biome.json points it at.
    const run = spawnSync(process.execPath, [biome, "lint", "--vcs-enabled=false", "--reporter=github"], {
      cwd: root,
      encoding: "utf8",
    });
    const findings = run.stdout.split("\n").flatMap((line) => {
      const m = FINDING.exec(line);
      return m ? [`${relative(root, m[2]!)} line ${m[3]!} ${m[1]!}`] : [];
    });
    expect(findings.sort(), run.stderr).toEqual([
      "assets/unity/js/broken.ts line 14 lint/nursery/noFloatingPromises",
      "assets/unity/js/broken.ts line 6 lint/nursery/useExhaustiveSwitchCases",
    ]);
    expect(run.status).toBe(1);
  });
});
