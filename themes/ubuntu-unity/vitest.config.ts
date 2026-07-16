import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The shell core is renderer-agnostic (every module imports ./terminal as a
// type only), so its tests run headlessly under Node with no xterm/DOM. esbuild
// resolves the codebase's extensionless imports (./terminal) the same way Hugo
// does, so no path rewriting is needed.
//
// `dir` anchors the include globs to the theme directory, so the suite runs
// identically from a standalone theme checkout and from a parent site via
// `vitest run --config themes/ubuntu-unity/vitest.config.ts`.
export default defineConfig({
  test: {
    environment: "node",
    dir: dirname(fileURLToPath(import.meta.url)),
    // The shell core plus any other DOM-free module with tests beside it
    // (midi.ts's parser/tempo-warp suite lives at assets/js/midi.test.ts).
    include: ["assets/js/**/*.test.ts"],
  },
});
