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

// The lowest contrast between an element's text and the colors behind
// it. Each stop of a gradient counts as a color behind the text, and a
// translucent layer blends with the layers under it.
function lowestContrast(target: Locator): Promise<number> {
  return target.evaluate((el) => {
    const channels = (text: string): number[] | undefined => {
      const m = /^(rgba?|color)\((?:srgb )?([^)]*)\)$/.exec(text.trim());
      if (!m) return undefined;
      const parts = (m[2] ?? "").split(/[\s,/]+/).filter(Boolean).map(Number);
      const scale = m[1] === "color" ? 255 : 1;
      return [(parts[0] ?? 0) * scale, (parts[1] ?? 0) * scale, (parts[2] ?? 0) * scale, parts[3] ?? 1];
    };
    const blend = (top: number[], under: number[]): number[] =>
      [0, 1, 2].map((i) => (top[i] ?? 0) * (top[3] ?? 1) + (under[i] ?? 0) * (1 - (top[3] ?? 1))).concat(1);
    const luminance = (c: number[]): number => {
      const [r, g, b] = c.slice(0, 3).map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    // The layers behind the text, from the element out to the first
    // opaque one. Each layer holds the colors it paints.
    const layers: number[][][] = [];
    for (let node: Element | null = el; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const stops = [...style.backgroundImage.matchAll(/(rgba?|color)\([^)]*\)/g)]
        .map((m) => channels(m[0]))
        .filter((c): c is number[] => c !== undefined);
      const fill = channels(style.backgroundColor);
      const layer = stops.length > 0 ? stops : fill && (fill[3] ?? 0) > 0 ? [fill] : [];
      if (layer.length === 0) continue;
      layers.push(layer);
      if (layer.every((c) => c[3] === 1)) break;
    }
    let behind = [[255, 255, 255, 1]];
    for (const layer of layers.reverse()) behind = layer.flatMap((c) => behind.map((under) => blend(c, under)));
    const ink = channels(getComputedStyle(el).color) ?? [0, 0, 0, 1];
    return Math.min(...behind.map((under) => {
      const [hi, lo] = [luminance(blend(ink, under)), luminance(under)].sort((a, b) => b - a);
      return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
    }));
  });
}

// A dark pair of content colors, such as a site sets in custom.css.
const DARK_PAIR: Readonly<Record<string, string>> = {
  "--up-content-bg": "#1E1E1E",
  "--up-content-fg": "#EEEEEE",
  "--up-content-muted": "#AAAAAA",
  "--up-content-line": "#444444",
  "--up-link": "#8AB4F8",
  "--up-sidebar-bg": "#2A2A2A",
};

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

test("the home page shows its link list while a link in it holds keyboard focus", async ({ page }) => {
  await open(page, "/");
  await expect(page.locator("[data-shell]")).toHaveAttribute("data-shell-ready", "");
  // The list holds the same links as the terminal's banner, for screen
  // readers, and it stays hidden until a link in it takes focus.
  const list = page.locator(".up-shell .up-sr-only");
  const links = await list.locator("a").count();
  expect(links).toBeGreaterThan(1);
  await page.locator(".up-tl-max").first().focus();
  await page.keyboard.press("Tab");
  const link = list.locator("a:focus");
  await expect(link).toHaveCount(1);
  await expect(list).toHaveCSS("clip-path", "none");
  await expect(link).toHaveCSS("outline-style", "solid");
  // The shorter side of an element's box. The list's box is 1px square
  // while the list hides.
  const side = (el: Element): number => {
    const r = el.getBoundingClientRect();
    return Math.min(r.width, r.height);
  };
  await expect.poll(() => list.evaluate(side)).toBeGreaterThan(1);
  await expect.poll(() => link.evaluate(side)).toBeGreaterThan(1);
  // The list paints over the terminal, so the link is the topmost
  // element at its center.
  await expect.poll(() => link.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === el;
  })).toBe(true);
  // Focus moves on to the terminal after the last link, and the list
  // hides again.
  for (let i = 0; i < links; i++) await page.keyboard.press("Tab");
  await expect(list.locator("a:focus")).toHaveCount(0);
  await expect(list).toHaveCSS("clip-path", "inset(50%)");
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

// The example site reads left to right, so the test sets dir="rtl" the
// way a right-to-left language does. The menu's name then starts the row
// at the right, and the arrow after it points left, at the English label.
test("the HUD mirrors its rows on a right-to-left page", async ({ page }) => {
  await open(page, "/about/");
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  const hud = page.locator("[data-up-hud]");
  await page.keyboard.press("Alt");
  await expect(hud.locator("[data-hud-input]")).toBeFocused();
  await page.keyboard.type("preferences");
  const path = hud.getByRole("option").first().locator(".up-hud-row-path");
  const label = hud.getByRole("option").first().locator(".up-hud-row-label");
  await expect(path).toHaveText("Edit ◂");
  const end = async (el: Locator): Promise<number> => {
    const box = await el.boundingBox();
    return box ? box.x + box.width : 0;
  };
  expect(await end(path)).toBeGreaterThan(await end(label));
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

test("a dark content pair keeps the text in a page and a dialog readable", async ({ page }) => {
  await open(page, "/about/");
  // The CSSOM sets the pair on <html>, which the policy allows.
  await page.evaluate((pair) => {
    for (const [name, value] of Object.entries(pair)) document.documentElement.style.setProperty(name, value);
  }, DARK_PAIR);
  await page.locator("#up-menu-edit").click();
  await page.locator('#up-dropdown-edit [data-action="dlg:prefs"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const texts = {
    "the Preferences title": dialog.locator(".up-dlg-content-title"),
    "a Preferences label": dialog.locator(".up-pref-row-label").first(),
    "inline code": page.locator(".up-page-body p > code").first(),
    "an alert's title": page.locator(".up-alert-title").first(),
    "an alert's body": page.locator(".up-alert-body > p").first(),
  };
  for (const [name, text] of Object.entries(texts)) {
    expect(await lowestContrast(text), name).toBeGreaterThanOrEqual(4.5);
  }
});

test("a code block with a line number table draws one box with one copy button", async ({ page }) => {
  await open(page, "/posts/2024/02/welcome-to-the-desktop/");
  // Hugo puts the line numbers and the code in a pre of their own each.
  const block = page.locator(".up-reader-body .highlight").filter({ has: page.locator("table") });
  await expect(block).toHaveCount(1);
  await expect(block.locator(".up-code-copy")).toHaveCount(1);
  await expect(block.locator("div:has(> table)")).toHaveCSS("border-top-width", "1px");
  const pres = block.locator("pre");
  await expect(pres).toHaveCount(2);
  for (const pre of await pres.all()) await expect(pre).toHaveCSS("border-top-width", "0px");
  // Each number lines up with its line of code, so the two columns end
  // at the same height.
  const heights = await block.locator("td code").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(heights).toHaveLength(2);
  expect(Math.abs((heights[0] ?? 0) - (heights[1] ?? 0))).toBeLessThan(1);
});

test("forced colors keep a menu opaque and fill the Studio's pressed buttons", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await open(page, "/about/");
  // Chromium writes an opaque color as rgb() and a translucent one as
  // rgba().
  await page.locator('[data-indicator="vol"]').click();
  await expect(page.locator("#up-dropdown-vol")).toHaveCSS("background-color", /^rgb\(/);
  // The CSSOM paints a probe, which the policy allows.
  const highlight = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "Highlight";
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await page.locator('[data-action="daw:open"]').click();
  const buttons = page.locator('[data-up-window="daw"] .up-daw-ms');
  for (const button of [buttons.nth(0), buttons.nth(1)]) {
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toHaveCSS("background-color", highlight);
  }
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
