// Checks for api.ts, the module a site's own scripts import. The suite runs
// under Node without a DOM. EventTargets stand in for window and document,
// and a Set stands in for the class list of document.body.

import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import * as api from "./api";
import { NOTIFY_EVENT, READY_CLASS, READY_EVENT } from "./events";
import type { UPDialogOptions } from "./types";

class ClassList extends Set<string> {
  contains(name: string): boolean {
    return this.has(name);
  }
}

type FakeWindow = EventTarget & Pick<Window, "uiDialog">;
type FakeDocument = EventTarget & { body: { classList: ClassList } | null };

let win: FakeWindow;
let doc: FakeDocument;

beforeEach(() => {
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { body: { classList: new ClassList() } });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", doc);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Starts the desktop the way app.ts does.
function start(): void {
  doc.body?.classList.add(READY_CLASS);
  doc.dispatchEvent(new CustomEvent(READY_EVENT, { detail: null }));
}

// Runs every pending promise callback.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function notifications(): unknown[] {
  const details: unknown[] = [];
  win.addEventListener(NOTIFY_EVENT, (e) => details.push(e instanceof CustomEvent ? e.detail : e));
  return details;
}

describe("api", () => {
  it("exports only its public names", () => {
    expect(Object.keys(api).sort()).toEqual(["NOTIFY_EVENT", "READY_EVENT", "dialog", "notify", "whenReady"]);
  });
});

describe("whenReady", () => {
  it("resolves at once after the desktop has started", async () => {
    start();
    await expect(api.whenReady()).resolves.toBeUndefined();
  });

  it("waits for the desktop to start", async () => {
    let ready = false;
    const done = api.whenReady().then(() => {
      ready = true;
    });
    await settle();
    expect(ready).toBe(false);
    start();
    await done;
    expect(ready).toBe(true);
  });

  it("waits when the parser has not reached body", async () => {
    doc.body = null;
    let ready = false;
    const done = api.whenReady().then(() => {
      ready = true;
    });
    await settle();
    expect(ready).toBe(false);
    doc.dispatchEvent(new CustomEvent(READY_EVENT, { detail: null }));
    await done;
    expect(ready).toBe(true);
  });
});

describe("notify", () => {
  it("raises the bubble after the desktop starts", async () => {
    const details = notifications();
    api.notify({ summary: "Saved", icon: "info" });
    await settle();
    expect(details).toEqual([]);
    start();
    await settle();
    expect(details).toEqual([{ summary: "Saved", icon: "info" }]);
  });

  it("raises the bubble on a started desktop", async () => {
    start();
    const details = notifications();
    api.notify({ summary: "Saved" });
    await settle();
    expect(details).toEqual([{ summary: "Saved" }]);
  });
});

describe("dialog", () => {
  // Resolves to the id of the call's last button.
  function installDialogs(): UPDialogOptions[] {
    const opened: UPDialogOptions[] = [];
    win.uiDialog = <const Id extends string = "ok">(opts: UPDialogOptions<Id>): Promise<Id | null> => {
      opened.push(opts);
      return Promise.resolve(opts.buttons?.at(-1)?.id ?? null);
    };
    return opened;
  }

  it("opens the dialog after the desktop starts and resolves to its result", async () => {
    const opened = installDialogs();
    const opts = {
      title: "Clear the draft?",
      buttons: [
        { id: "keep", label: "Keep" },
        { id: "clear", label: "Clear", primary: true, danger: true },
      ],
    } as const;
    const result = api.dialog(opts);
    await settle();
    expect(opened).toEqual([]);
    start();
    expect(await result).toBe("clear");
    expect(opened).toEqual([opts]);
  });

  it("resolves to null on a page without dialogs", async () => {
    start();
    expect(await api.dialog({ title: "Information" })).toBeNull();
  });

  it("resolves to one of the call's button ids or null", () => {
    const confirm = () =>
      api.dialog({
        buttons: [
          { id: "cancel", label: "Cancel" },
          { id: "delete", label: "Delete", primary: true, danger: true },
        ],
      });
    expectTypeOf(confirm).returns.resolves.toEqualTypeOf<"cancel" | "delete" | null>();
    const info = () => api.dialog({ title: "Information" });
    expectTypeOf(info).returns.resolves.toEqualTypeOf<"ok" | null>();
  });
});
