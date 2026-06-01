import { defineConfig } from "vitest/config";

// The shell core is renderer-agnostic (every module imports ./terminal as a
// type only), so its tests run headlessly under Node with no xterm/DOM. esbuild
// resolves the codebase's extensionless imports (./terminal) the same way Hugo
// does, so no path rewriting is needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["themes/ubuntu-unity/assets/js/shell/**/*.test.ts"],
  },
});
