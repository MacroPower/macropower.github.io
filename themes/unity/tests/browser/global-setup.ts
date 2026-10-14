// Builds the example site the way a production deploy does and serves it
// on a local port for the whole run. The specs find the build and the
// server through environment variables. Playwright starts its workers
// after this setup returns, so each worker inherits them.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { listen } from "./server";

const theme = resolve(import.meta.dirname, "../..");

export const ROOT_ENV = "UNITY_BROWSER_ROOT";
export const URL_ENV = "UNITY_BROWSER_URL";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const out = mkdtempSync(join(tmpdir(), "unity-browser-"));
  const server = await listen();
  const teardown = async (): Promise<void> => {
    await server.close();
    rmSync(out, { recursive: true, force: true });
  };
  // The build's baseURL is the server's own origin, so every absolute URL
  // in the pages resolves to the server. hugo builds for the production
  // environment unless told otherwise.
  const build = spawnSync("hugo", [
    "--source", join(theme, "exampleSite"),
    "--themesDir", dirname(theme),
    "--destination", out,
    "--baseURL", server.url,
    "--minify",
    "--quiet",
  ], { encoding: "utf8" });
  if (build.status !== 0) {
    await teardown();
    throw new Error(`hugo failed to build the example site\n${build.error?.message ?? ""}${build.stdout ?? ""}${build.stderr ?? ""}`);
  }
  server.serve(out);
  process.env[ROOT_ENV] = out;
  process.env[URL_ENV] = server.url;
  return teardown;
}
