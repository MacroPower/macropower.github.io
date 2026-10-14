import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installTitlebarDrag } from "./drag";
import { followSystemMotion, isReduceMotion, scrollBehavior, setReduceMotion } from "./prefs";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = readdirSync(here, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));

// The CSS animation-kill stops animations and transitions, but it cannot
// reach a scroll or an animation frame that a script starts. These tests
// cover the script motion that reduce-motion must stop, and the body class
// that tells each script to stop it.

const classes = new Set<string>();

beforeEach(() => {
  classes.clear();
  vi.stubGlobal("document", {
    body: {
      classList: {
        contains: (name: string): boolean => classes.has(name),
        toggle: (name: string, on: boolean): boolean => {
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scroll behavior", () => {
  it("smooth scrolls only while motion is on", () => {
    expect(scrollBehavior()).toBe("smooth");
    setReduceMotion(true);
    expect(scrollBehavior()).toBe("instant");
  });

  it("names a smooth scroll only in prefs.ts", () => {
    const strays = scripts
      .filter((file) => file !== "prefs.ts")
      .filter((file) => /(["'`])smooth\1/.test(readFileSync(join(here, file), "utf8")));
    expect(strays).toEqual([]);
  });
});

// A stand-in for the media query list that matchMedia returns. Setting
// `matches` through `change()` fires a change event, as the browser does
// when the visitor changes the system setting.
class SystemSetting extends EventTarget {
  matches: boolean;
  constructor(matches: boolean) {
    super();
    this.matches = matches;
  }
  change(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new Event("change"));
  }
}

describe("system setting", () => {
  let queries: string[];

  function follow(matches: boolean): SystemSetting {
    const setting = new SystemSetting(matches);
    vi.stubGlobal("window", {
      matchMedia: (query: string): SystemSetting => {
        queries.push(query);
        return setting;
      },
    });
    followSystemMotion();
    return setting;
  }

  beforeEach(() => {
    queries = [];
  });

  it("reads the reduced-motion media query", () => {
    follow(false);
    expect(queries).toEqual(["(prefers-reduced-motion: reduce)"]);
  });

  it("starts from the system setting", () => {
    follow(true);
    expect(isReduceMotion()).toBe(true);
    expect(scrollBehavior()).toBe("instant");
  });

  it("follows a change to the system setting without a reload", () => {
    const setting = follow(false);
    expect(isReduceMotion()).toBe(false);
    setting.change(true);
    expect(isReduceMotion()).toBe(true);
    setting.change(false);
    expect(isReduceMotion()).toBe(false);
  });

  it("keeps a choice from Preferences until the system setting changes", () => {
    const setting = follow(true);
    setReduceMotion(false);
    expect(isReduceMotion()).toBe(false);
    setting.change(false);
    setting.change(true);
    expect(isReduceMotion()).toBe(true);
  });

  it("names the media query only in prefs.ts", () => {
    const strays = scripts
      .filter((file) => file !== "prefs.ts")
      .filter((file) => /(["'`])[^"'`\n]*prefers-reduced-motion/.test(readFileSync(join(here, file), "utf8")));
    expect(strays).toEqual([]);
  });
});

// A stand-in for the window chrome. It is its own titlebar, so a press
// anywhere on it starts a drag.
class Chrome extends EventTarget {
  style = { transform: "" };
  closest(selector: string): Chrome | null {
    return selector === "button" ? null : this;
  }
  contains(other: unknown): boolean {
    return other === this;
  }
  getBoundingClientRect(): { top: number } {
    return { top: 100 };
  }
  setPointerCapture(): void { /* nothing to capture */ }
  releasePointerCapture(): void { /* nothing to release */ }
}

function pointer(type: string, x: number, y: number): Event {
  return Object.assign(new Event(type, { cancelable: true }), {
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerId: 1,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
  });
}

describe("titlebar drag", () => {
  let frames: FrameRequestCallback[];
  let chrome: Chrome;

  beforeEach(() => {
    frames = [];
    chrome = new Chrome();
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("Element", Chrome);
    vi.stubGlobal("MouseEvent", Event);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", (): void => { /* frames run by hand */ });
  });

  function dragAndDrop(spring: boolean): void {
    installTitlebarDrag(chrome as unknown as HTMLElement, { spring });
    chrome.dispatchEvent(pointer("pointerdown", 10, 10));
    window.dispatchEvent(pointer("pointermove", 160, 100));
    expect(chrome.style.transform).toMatch(/^translate3d\(/);
    window.dispatchEvent(pointer("pointerup", 160, 100));
  }

  it("springs the window home over animation frames", () => {
    dragAndDrop(true);
    expect(chrome.style.transform).toMatch(/^translate3d\(/);
    let now = performance.now();
    for (let i = 0; i < 200 && frames.length; i++) {
      now += 16;
      frames.shift()!(now);
    }
    expect(frames).toEqual([]);
    expect(chrome.style.transform).toBe("");
  });

  it("jumps the window home under reduce motion", () => {
    setReduceMotion(true);
    dragAndDrop(true);
    expect(chrome.style.transform).toBe("");
    expect(frames).toEqual([]);
  });

  it("leaves a free window where it was dropped under reduce motion", () => {
    setReduceMotion(true);
    dragAndDrop(false);
    expect(chrome.style.transform).toBe("translate3d(150px, 90px, 0)");
    expect(frames).toEqual([]);
  });
});
