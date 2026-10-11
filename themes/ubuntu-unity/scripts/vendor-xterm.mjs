#!/usr/bin/env node
// Refreshes assets/vendor/xterm/ from the npm registry. Edit the versions
// below, run `npm run vendor:xterm`, and commit the result. Bump the
// structural xterm CSS in main.css to the same @xterm/xterm version.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGES = {
  "@xterm/xterm": { version: "6.0.0", lib: "xterm.mjs", typings: "xterm.d.ts" },
  "@xterm/addon-fit": { version: "0.11.0", lib: "addon-fit.mjs", typings: "addon-fit.d.ts" },
  "@xterm/addon-web-links": { version: "0.12.0", lib: "addon-web-links.mjs", typings: "addon-web-links.d.ts" },
};

const dest = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "vendor", "xterm");
const work = mkdtempSync(join(tmpdir(), "vendor-xterm-"));

try {
  const licenses = [];
  for (const [name, pkg] of Object.entries(PACKAGES)) {
    const tarball = execFileSync("npm", ["pack", `${name}@${pkg.version}`, "--silent"], { cwd: work })
      .toString()
      .trim();
    const unpacked = join(work, name.replace("/", "__"));
    execFileSync("mkdir", ["-p", unpacked]);
    execFileSync("tar", ["-xzf", join(work, tarball), "-C", unpacked, "--strip-components=1"]);

    // The source maps stay behind, so drop the comment that points at them.
    const lib = readFileSync(join(unpacked, "lib", pkg.lib), "utf8").replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n");
    writeFileSync(join(dest, pkg.lib), lib);
    copyFileSync(join(unpacked, "typings", pkg.typings), join(dest, pkg.typings));
    licenses.push(`${name}@${pkg.version}\n\n${readFileSync(join(unpacked, "LICENSE"), "utf8").trim()}\n`);
  }
  writeFileSync(join(dest, "LICENSE"), licenses.join("\n---\n\n"));
} finally {
  rmSync(work, { recursive: true, force: true });
}
