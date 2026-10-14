#!/usr/bin/env node
// Refreshes assets/unity/third_party/pdf-js/ from the npm registry. Edit the version
// below, run `npm run vendor:pdfjs`, and commit the result.
//
// The theme vendors pdf.js's legacy build. The modern build calls
// JavaScript built-ins only the newest browsers ship, while the legacy
// build polyfills them and runs on Chrome 125, Safari 18, and Firefox ESR.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "6.4.299";
const FILES = ["pdf.min.mjs", "pdf.worker.min.mjs"];

const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "unity", "third_party", "pdf-js");
const work = mkdtempSync(join(tmpdir(), "vendor-pdfjs-"));

try {
  const tarball = execFileSync("npm", ["pack", `pdfjs-dist@${VERSION}`, "--silent"], { cwd: work, encoding: "utf8" }).trim();
  execFileSync("tar", ["-xzf", join(work, tarball), "-C", work]);
  for (const file of FILES) {
    copyFileSync(join(work, "package", "legacy", "build", file), join(dest, file));
  }
  copyFileSync(join(work, "package", "LICENSE"), join(dest, "LICENSE"));
} finally {
  rmSync(work, { recursive: true, force: true });
}
