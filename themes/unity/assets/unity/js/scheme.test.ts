import { afterEach, describe, expect, it, vi } from "vitest";

import { bootScheme, chooseScheme, initSchemeToggle } from "./scheme";

// A stand-in for the media query list that matchMedia returns. change()
// fires a change event, as the browser does when the visitor changes the
// system setting.
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

// A stand-in for an element that records its attributes.
class FakeElement extends EventTarget {
  readonly attrs = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
}

interface Desktop {
  system: SystemSetting;
  html: FakeElement;
  toggle: FakeElement;
  store: Map<string, string>;
}

// Stubs the globals that scheme.ts reads. A broken store throws on every
// call, as localStorage does in some private modes.
function desktop(dark: boolean, stored?: string, broken = false): Desktop {
  const system = new SystemSetting(dark);
  const html = new FakeElement();
  const toggle = new FakeElement();
  const store = new Map<string, string>(stored === undefined ? [] : [["up:scheme", stored]]);
  const guard = <T>(fn: () => T): T => {
    if (broken) throw new Error("storage is unavailable");
    return fn();
  };
  vi.stubGlobal("window", { matchMedia: (): SystemSetting => system });
  vi.stubGlobal("document", {
    documentElement: html,
    querySelector: (selector: string): FakeElement | null => (selector === "[data-scheme-toggle]" ? toggle : null),
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string): string | null => guard(() => store.get(key) ?? null),
    setItem: (key: string, value: string): void => guard(() => void store.set(key, value)),
    removeItem: (key: string): void => guard(() => void store.delete(key)),
  });
  return { system, html, toggle, store };
}

const scheme = (d: Desktop): string | undefined => d.html.attrs.get("data-up-scheme");
const click = (d: Desktop): void => void d.toggle.dispatchEvent(new Event("click"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scheme", () => {
  it("starts from the system's preference without a stored choice", () => {
    const d = desktop(true);
    bootScheme();
    expect(scheme(d)).toBe("dark");
  });

  it("starts from a stored choice over the system's preference", () => {
    const d = desktop(true, "light");
    bootScheme();
    expect(scheme(d)).toBe("light");
  });

  it("ignores a stored value that names no scheme", () => {
    const d = desktop(false, "sepia");
    bootScheme();
    expect(scheme(d)).toBe("light");
  });

  it("follows the system's preference only without a stored choice", () => {
    const d = desktop(false);
    bootScheme();
    d.system.change(true);
    expect(scheme(d)).toBe("dark");
    chooseScheme("light");
    d.system.change(false);
    d.system.change(true);
    expect(scheme(d)).toBe("light");
  });

  it("stores only a choice that differs from the system's preference", () => {
    const d = desktop(true);
    chooseScheme("light");
    expect(d.store.get("up:scheme")).toBe("light");
    chooseScheme("dark");
    expect(d.store.has("up:scheme")).toBe(false);
  });

  it("flips the scheme on each click and reports it through aria-pressed", () => {
    const d = desktop(false);
    bootScheme();
    initSchemeToggle();
    expect(d.toggle.attrs.get("aria-pressed")).toBe("false");
    click(d);
    expect([scheme(d), d.toggle.attrs.get("aria-pressed"), d.store.get("up:scheme")]).toEqual(["dark", "true", "dark"]);
    click(d);
    expect([scheme(d), d.toggle.attrs.get("aria-pressed"), d.store.has("up:scheme")]).toEqual(["light", "false", false]);
  });

  it("keeps aria-pressed in step with a change of the system's preference", () => {
    const d = desktop(false);
    bootScheme();
    initSchemeToggle();
    d.system.change(true);
    expect([scheme(d), d.toggle.attrs.get("aria-pressed")]).toEqual(["dark", "true"]);
  });

  it("works without localStorage until the next page load", () => {
    const d = desktop(true, undefined, true);
    bootScheme();
    initSchemeToggle();
    expect(scheme(d)).toBe("dark");
    click(d);
    expect([scheme(d), d.toggle.attrs.get("aria-pressed")]).toEqual(["light", "false"]);
    click(d);
    expect([scheme(d), d.toggle.attrs.get("aria-pressed")]).toEqual(["dark", "true"]);
  });
});
