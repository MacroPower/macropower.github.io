#!/usr/bin/env node
// Refreshes assets/unity/third_party/pdf-js/ from the npm registry. Edit the version
// below, run `npm run vendor:pdfjs`, and commit the result.
//
// The theme vendors pdf.js's legacy build. The modern build calls
// JavaScript built-ins that only the newest browsers ship. The legacy
// build polyfills them and runs on Chrome 125, Safari 18, and Firefox ESR.
//
// The cv bundle inlines pdf.min.mjs, and esbuild keeps only legal
// comments in a bundle. The script opens the library's licence header
// with /*! so that esbuild keeps it. That one character is the copy's
// only difference from upstream. Sites publish the worker as its own
// file, so the script copies it unchanged.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "6.4.299";

const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "unity", "third_party", "pdf-js");
const work = mkdtempSync(join(tmpdir(), "vendor-pdfjs-"));

try {
  const tarball = execFileSync("npm", ["pack", `pdfjs-dist@${VERSION}`, "--silent"], { cwd: work, encoding: "utf8" }).trim();
  execFileSync("tar", ["-xzf", join(work, tarball), "-C", work]);
  const build = join(work, "package", "legacy", "build");

  const lib = readFileSync(join(build, "pdf.min.mjs"), "utf8");
  if (!lib.startsWith("/**\n * @licstart")) throw new Error("pdf.min.mjs does not open with its licence header");
  writeFileSync(join(dest, "pdf.min.mjs"), `/*!${lib.slice(3)}`);
  copyFileSync(join(build, "pdf.worker.min.mjs"), join(dest, "pdf.worker.min.mjs"));
  copyFileSync(join(work, "package", "LICENSE"), join(dest, "LICENSE"));
} finally {
  rmSync(work, { recursive: true, force: true });
}
