import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

// Runs the browser smoke suite against the example site in Chromium.
// global-setup.ts builds the site and serves it, and `npm run test:browser`
// runs this config. Install the browser with `npx playwright install chromium`.
export default defineConfig({
  testDir: ".",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  // The suite writes no screenshots or traces, so nothing lands in the
  // theme's directory.
  outputDir: join(tmpdir(), "unity-browser-results"),
  expect: { timeout: 10_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
