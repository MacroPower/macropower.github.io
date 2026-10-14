// Builds a small site whose extend-head.html and extend-footer.html load a
// probe script with each tag. The test checks each probe against
// README.md's table of when a site's script runs. A probe records whether
// <body> had the up-ready class when the probe ran and whether the up:ready
// event reached it. The api probes record whether the desktop had started
// when whenReady() from unity/js/api resolved. An async script might run
// before or after the desktop starts, so no probe covers one.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { READY_CLASS, READY_EVENT } from "../../assets/unity/js/events";
import { listen, type Server } from "./server";

const theme = resolve(import.meta.dirname, "../..");

function probe(name: string): string {
  const key = JSON.stringify(name);
  return `(window.probes ??= {})[${key}] = { ready: document.body?.classList.contains(${JSON.stringify(READY_CLASS)}) ?? false, event: false };
document.addEventListener(${JSON.stringify(READY_EVENT)}, () => { window.probes[${key}].event = true; });
`;
}

function apiProbe(name: string): string {
  return `import { whenReady } from "unity/js/api";
void whenReady().then(() => {
  (window.probes ??= {})[${JSON.stringify(name)}] = { started: document.body.classList.contains(${JSON.stringify(READY_CLASS)}) };
});
`;
}

// The footer's api probe loads through the tag in README.md's Script API
// example.
const FILES: Readonly<Record<string, string>> = {
  "hugo.toml": 'theme = "unity"\n',
  "content/about.md": "+++\ntitle = 'About'\n+++\nBody of About.\n",
  "static/probes/head-classic.js": probe("head-classic"),
  "static/probes/head-defer.js": probe("head-defer"),
  "static/probes/head-module.js": probe("head-module"),
  "static/probes/footer-classic.js": probe("footer-classic"),
  "static/probes/footer-defer.js": probe("footer-defer"),
  "static/probes/footer-module.js": probe("footer-module"),
  "assets/js/head-api.ts": apiProbe("head-api"),
  "assets/js/footer-api.ts": apiProbe("footer-api"),
  "layouts/_partials/extend-head.html": `<script src="/probes/head-classic.js"></script>
<script defer src="/probes/head-defer.js"></script>
<script type="module" src="/probes/head-module.js"></script>
{{ with resources.Get "js/head-api.ts" | js.Build | fingerprint }}
  <script src="{{ .RelPermalink }}" integrity="{{ .Data.Integrity }}"></script>
{{ end }}
`,
  "layouts/_partials/extend-footer.html": `<script src="/probes/footer-classic.js"></script>
<script defer src="/probes/footer-defer.js"></script>
<script type="module" src="/probes/footer-module.js"></script>
{{ with resources.Get "js/footer-api.ts" | js.Build (dict "minify" hugo.IsProduction) | fingerprint }}
  <script defer src="{{ .RelPermalink }}" integrity="{{ .Data.Integrity }}"></script>
{{ end }}
`,
};

// A probe that runs before the desktop starts misses the class and gets
// the event. A probe that runs after it sees the class and never gets the
// event.
const EXPECTED: Readonly<Record<string, unknown>> = {
  "head-classic": { ready: false, event: true },
  "head-defer": { ready: false, event: true },
  "head-module": { ready: false, event: true },
  "head-api": { started: true },
  "footer-classic": { ready: false, event: true },
  "footer-defer": { ready: true, event: false },
  "footer-module": { ready: true, event: false },
  "footer-api": { started: true },
};

let dir = "";
let server: Server | undefined;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "unity-hooks-"));
  const source = join(dir, "site");
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), text);
  }
  server = await listen();
  const build = spawnSync("hugo", [
    "--source", source,
    "--themesDir", dirname(theme),
    "--destination", join(dir, "public"),
    "--baseURL", server.url,
    "--quiet",
  ], { encoding: "utf8" });
  if (build.status !== 0) {
    throw new Error(`hugo failed to build the hooks site\n${build.error?.message ?? ""}${build.stdout ?? ""}${build.stderr ?? ""}`);
  }
  server.serve(join(dir, "public"));
});

test.afterAll(async () => {
  await server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test("each hook script runs where README.md says", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`uncaught ${err.name}: ${err.message}`));
  await page.goto(new URL("about/", server?.url).href);
  await expect(page.locator("body")).toContainClass(READY_CLASS);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "probes"))).toEqual(EXPECTED);
  expect(errors, "the page reported errors").toEqual([]);
});
