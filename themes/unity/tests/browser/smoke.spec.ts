// Loads the built example site in Chromium under the Content Security
// Policy that README.md documents. Every page must start the desktop
// without an uncaught exception or a console error. app.ts logs a console
// error for each module that fails to start. Chromium logs one for each
// inline script or style that the policy blocks. The other tests each
// drive one feature, such as the home terminal or the Dash.
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

import { expect, type Locator, type Page, test as base } from "@playwright/test";

import { READY_CLASS } from "../../assets/unity/js/events";
import { ROOT_ENV, URL_ENV } from "./global-setup";

const root = process.env[ROOT_ENV] ?? "";
const origin = process.env[URL_ENV] ?? "";

// Every test fails on any error that its page reports. Requests to other
// hosts, such as the players that the welcome post embeds, get an empty
// response. The suite then runs offline, and only the site's own scripts
// can report an error.
const test = base.extend<{ problems: string[] }>({
  problems: [async ({ page }, use) => {
    const problems: string[] = [];
    const site = new URL(origin).origin;
    await page.route((url) => url.origin !== site, (route) => route.fulfill({ status: 204 }));
    page.on("pageerror", (err) => problems.push(`uncaught ${err.name}: ${err.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console error: ${msg.text()}`);
    });
    await use(problems);
    expect(problems, "the page reported errors").toEqual([]);
  }, { auto: true }],
});
test.use({ baseURL: origin });

// The path of each page the build wrote: every HTML file that holds a
// whole document. The Dash's sections are an HTML fragment, and only the
// Dash loads them.
function pages(): string[] {
  if (!root) return [];
  return readdirSync(root, { encoding: "utf8", recursive: true })
    .filter((f) => f.endsWith(".html") && /^<!doctype html>/i.test(readFileSync(join(root, f), "utf8")))
    .map((f) => `/${f.split(sep).join("/")}`.replace(/\/index\.html$/, "/"))
    .sort();
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("body")).toContainClass(READY_CLASS);
}

// The number of pixels a canvas has painted.
function painted(canvas: Locator): Promise<number> {
  return canvas.evaluate((el: HTMLCanvasElement) => {
    if (!el.width || !el.height) return 0;
    const data = el.getContext("2d")?.getImageData(0, 0, el.width, el.height).data ?? [];
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) n++;
    return n;
  });
}

test.describe("every page", () => {
  for (const path of pages()) {
    test(path, async ({ page }) => {
      await open(page, path);
    });
  }
});

test("the home terminal boots and runs a command", async ({ page }) => {
  await open(page, "/");
  await expect(page.locator("[data-shell]")).toHaveAttribute("data-shell-ready", "");
  await page.locator("[data-shell-mount] .xterm-helper-textarea").focus();
  await page.keyboard.type("echo unity | rev");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-shell-mount] .xterm-rows")).toContainText("ytinu");
});

test("a panel menu opens and closes from the keyboard", async ({ page }) => {
  await open(page, "/about/");
  const trigger = page.locator("#up-menu-help");
  const menu = page.locator("#up-dropdown-help");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
});

test("the Dash finds a post", async ({ page }) => {
  await open(page, "/about/");
  const dash = page.locator("[data-up-dash]");
  await page.locator("[data-dash-open]").click();
  await expect(dash).toBeVisible();
  await expect(dash.locator("[data-dash-search]")).toBeFocused();
  await page.keyboard.type("homelab");
  const hit = dash.locator('[data-dash-section="files"] [data-dash-tile]', { hasText: "homelab" });
  await expect(hit.first()).toBeVisible();
  // The first Escape clears the query, and the second closes the Dash.
  await page.keyboard.press("Escape");
  await expect(dash.locator("[data-dash-search]")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dash).toBeHidden();
});

test("a dialog opens and closes", async ({ page }) => {
  await open(page, "/about/");
  await page.locator("#up-menu-help").click();
  await page.locator('#up-dropdown-help [data-action="dlg:shortcuts"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the solitaire table draws", async ({ page }) => {
  await open(page, "/solitaire/");
  await expect.poll(() => painted(page.locator("[data-sol-canvas]"))).toBeGreaterThan(0);
});

test("the CV renders its PDF", async ({ page }) => {
  await open(page, "/cv/");
  await expect.poll(() => painted(page.locator("[data-docv-pages] canvas").first())).toBeGreaterThan(0);
});

test("the Studio opens and draws its piano roll", async ({ page }) => {
  await open(page, "/about/");
  await page.locator('[data-indicator="vol"]').click();
  await page.locator('[data-action="daw:open"]').click();
  await expect(page.locator('[data-up-window="daw"]')).toBeVisible();
  await expect(page.locator('[data-launcher="studio"]')).toBeVisible();
  await expect.poll(() => painted(page.locator("[data-daw-canvas]"))).toBeGreaterThan(0);
});
