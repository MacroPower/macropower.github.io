// Loads the built example site in Chromium under the Content Security
// Policy that README.md documents. Every page must load and start the
// desktop without an uncaught exception or a console error. app.ts logs a
// console error for each module that fails to start. Chromium logs one for
// each inline script or style that the policy blocks. The other tests each
// drive one feature, such as the home terminal or the Dash.
//
// The test of each page waits until the page's own startup settles, such
// as the home terminal's boot. The error check then waits one frame and
// one task more. It misses an error from a later timer, such as the
// clock's next tick.
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
    // The page reports an error from a timer or a frame callback only when
    // the callback runs. Wait one frame and one task, so the callbacks that
    // are already due run before the check.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r))));
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

// Waits for the startup that a page's own bundle runs after app.ts adds
// the up-ready class to the body. The home terminal boots after its fonts
// load, and the CV and the solitaire table each paint a canvas.
async function started(page: Page): Promise<void> {
  const shell = page.locator("[data-shell]");
  if (await shell.count()) await expect(shell).toHaveAttribute("data-shell-ready", "");
  if (await page.locator("[data-docv-pages]").count()) {
    await expect.poll(() => painted(page.locator("[data-docv-pages] canvas").first())).toBeGreaterThan(0);
  }
  const table = page.locator("[data-sol-canvas]");
  if (await table.count()) await expect.poll(() => painted(table)).toBeGreaterThan(0);
}

test.describe("every page", () => {
  for (const path of pages()) {
    test(path, async ({ page }) => {
      await open(page, path);
      await started(page);
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

// The sound menu's mute button shows only an icon, so the HUD finds it by
// its aria-label.
test("the HUD finds and runs an icon-only control", async ({ page }) => {
  await open(page, "/about/");
  const hud = page.locator("[data-up-hud]");
  await page.keyboard.press("Alt");
  await expect(hud.locator("[data-hud-input]")).toBeFocused();
  await page.keyboard.type("mute");
  await expect(hud.getByRole("option").first()).toContainText("Toggle mute");
  await page.keyboard.press("Enter");
  await expect(hud).toBeHidden();
  await expect(page.locator("[data-vol-readout]")).toHaveText("—");
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

// Each toggle group marks its chosen button pressed, so a screen reader
// names the one in effect. A click moves the mark to the clicked button.
async function pressMoves(group: Locator, choice: Locator): Promise<void> {
  await expect(group.getByRole("button", { pressed: true })).toHaveCount(1);
  await expect(choice).toHaveAttribute("aria-pressed", "false");
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { pressed: true })).toHaveCount(1);
}

test("the Preferences dialog marks the chosen accent pressed", async ({ page }) => {
  await open(page, "/about/");
  await page.locator("#up-menu-edit").click();
  await page.locator('#up-dropdown-edit [data-action="dlg:prefs"]').click();
  const group = page.getByRole("dialog").getByRole("group", { name: "Accent color" });
  const start = await page.evaluate(() => document.documentElement.dataset.upAccent);
  await expect(group.getByRole("button", { pressed: true })).toHaveAttribute("data-up-accent", start ?? "");
  const other = await group.getByRole("button", { pressed: false }).first().getAttribute("data-up-accent");
  await pressMoves(group, group.locator(`[data-up-accent="${other}"]`));
});

test("the icon vault marks the chosen size and backdrop pressed", async ({ page }) => {
  await open(page, "/icons/");
  const section = page.locator(".up-icons-section").first();
  for (const name of ["Size", "Background"]) {
    const group = section.getByRole("group", { name });
    await pressMoves(group, group.getByRole("button").last());
  }
});

// The post list hears its keys on the document. Each of the next tests
// gives a key to something else on the page, and the list leaves it
// alone.
test("the post list leaves its search key to an open dialog", async ({ page }) => {
  await open(page, "/posts/");
  await page.locator("#up-menu-help").click();
  await page.locator('#up-dropdown-help [data-action="dlg:shortcuts"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const inDialog = (): Promise<boolean> =>
    page.evaluate(() => document.activeElement?.closest("#up-dialog-host") != null);
  await expect.poll(inDialog).toBe(true);
  await page.keyboard.press("/");
  await expect(page.locator("[data-up-search-bar]")).toBeHidden();
  await expect.poll(inDialog).toBe(true);
});

test("the post list leaves the keys typed on a Dash tile to the Dash", async ({ page }) => {
  await open(page, "/posts/");
  const dash = page.locator("[data-up-dash]");
  await page.locator("[data-dash-open]").click();
  await expect(dash.locator("[data-dash-search]")).toBeFocused();
  await expect(dash.locator("[data-dash-tile]").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => page.evaluate(() => document.activeElement?.hasAttribute("data-dash-tile"))).toBe(true);
  await page.keyboard.type("jk");
  await expect(dash.locator("[data-dash-search]")).toHaveValue("jk");
  await expect(page.locator("[data-up-post-row].is-focused")).toHaveCount(0);
});

test("the post list ignores its keys after the page window closes", async ({ page }) => {
  await open(page, "/posts/");
  const url = page.url();
  await page.locator("[data-page-window] .up-tl-close").click();
  await expect.poll(() => page.evaluate(() => window.UP_PAGE_WINDOW_STATE?.closed)).toBe(true);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press("j");
  await expect(page.locator("[data-up-post-row].is-focused")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(url);
});

test("the solitaire table draws", async ({ page }) => {
  await open(page, "/solitaire/");
  await expect.poll(() => painted(page.locator("[data-sol-canvas]"))).toBeGreaterThan(0);
});

// Undo disables itself when it empties the history, and the browser drops
// focus from a disabled button to the page body. The table must take focus
// instead, so the game's keys keep working.
test("the solitaire toolbar keeps focus in the game", async ({ page }) => {
  await open(page, "/solitaire/");
  await expect(page.locator("[data-solitaire]")).toHaveAttribute("data-sol-ready", "");
  const undo = page.locator('[data-sol-action="undo"]');
  await page.locator('[data-sol-action="draw-stock"]').focus();
  await page.keyboard.press("Enter");
  await expect(undo).toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(undo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(undo).toBeDisabled();
  const inGame = (): Promise<boolean> => page.evaluate(() => {
    const el = document.activeElement;
    return el instanceof HTMLElement && el.closest("[data-solitaire]") != null && !el.matches(":disabled, [hidden]");
  });
  await expect.poll(inGame).toBe(true);
  await page.keyboard.press("s");
  await expect(undo).toBeEnabled();
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
