#!/usr/bin/env node
// Captures images/screenshot.png and images/tn.png, which themes.gohugo.io
// shows for the theme, from the home page of the example site. It builds the
// site the way a production deploy does, at its own baseURL. It then opens the
// build in Chromium through Playwright. The browser asks for each page at the
// baseURL's host. The script answers each request from the build on disk, so
// the terminal's prompt names that host. A fixed clock, time zone, and locale
// make two runs draw the same panel clock. Run it with `npm run gallery`. It
// needs Hugo on PATH and the Chromium that `npx playwright install chromium`
// downloads.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { type Browser, chromium, type Route } from "@playwright/test";

const theme = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The baseURL that exampleSite/hugo.toml sets.
const ORIGIN = "https://example.org";

// The panel clock and the banner's uptime read this time.
const NOW = new Date("2026-07-16T14:49:00Z");

// README.md documents the class that the desktop sets on <body> after it
// starts.
const READY = "body.up-ready";

// The gallery wants a 1500x1000 screenshot and a 900x600 thumbnail. Chromium
// lays each page out at width by height and draws it at scale times that size.
// The thumbnail's layout is larger than the image. At a 900x600 layout, the
// banner overflows the terminal window, and the terminal scrolls its top out
// of view.
const SHOTS = [
  { file: "screenshot.png", width: 1500, height: 1000, scale: 1 },
  { file: "tn.png", width: 1125, height: 750, scale: 0.8 },
] as const;

const out = mkdtempSync(join(tmpdir(), "unity-gallery-"));
let browser: Browser | undefined;
try {
  build();
  browser = await chromium.launch();
  for (const shot of SHOTS) {
    const size = await capture(browser, shot.file, shot.width, shot.height, shot.scale);
    console.log(`wrote images/${shot.file} at ${size}`);
  }
} finally {
  await browser?.close();
  rmSync(out, { recursive: true, force: true });
}

function build(): void {
  const run = spawnSync("hugo", [
    "--source", join(theme, "exampleSite"),
    "--themesDir", dirname(theme),
    "--destination", out,
    "--environment", "production",
    "--minify",
    "--quiet",
  ], { encoding: "utf8" });
  if (run.status !== 0) {
    throw new Error(`hugo failed to build the example site\n${run.error?.message ?? ""}${run.stdout ?? ""}${run.stderr ?? ""}`);
  }
}

// Writes the home page to images/<file> and returns the image's size.
async function capture(browser: Browser, file: string, width: number, height: number, scale: number): Promise<string> {
  // Under reduced motion, the desktop starts without its animations.
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await page.clock.setFixedTime(NOW);
    await page.route(() => true, serve);
    await page.goto(`${ORIGIN}/`);
    await page.locator(READY).waitFor({ state: "attached" });
    // The terminal prints its banner and then the prompt.
    await page.getByText(`user@${new URL(ORIGIN).host}:~$`).waitFor();
    await page.evaluate("document.fonts.ready");
    const png = await page.screenshot({ path: join(theme, "images", file), animations: "disabled" });
    // A PNG's header holds its width and height at bytes 16 and 20.
    return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
  } finally {
    await context.close();
  }
}

// Answers a request for the site's host from the build, the way a static host
// does. Every other request gets an empty response, so the capture runs
// offline.
async function serve(route: Route): Promise<void> {
  const url = new URL(route.request().url());
  if (url.origin !== ORIGIN) {
    await route.fulfill({ status: 204 });
    return;
  }
  const file = lookup(url.pathname);
  await route.fulfill(file ? { path: file } : { status: 404, path: join(out, "404.html") });
}

// The file in the build that a URL path names, or undefined when no file
// matches. A path that ends in a slash names the index.html under it.
function lookup(pathname: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const file = join(out, normalize(path.endsWith("/") ? `${path}index.html` : path));
  if (!file.startsWith(out + sep)) return undefined;
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}
