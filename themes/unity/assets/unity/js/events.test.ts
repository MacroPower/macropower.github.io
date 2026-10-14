// Checks for the dispatch helpers in events.ts. The type checks make
// `npm run typecheck:test` fail when a dispatch pairs an event with the
// wrong detail or the wrong target. Each of them reads the type of a
// function that never runs. The suite runs under Node without a DOM, so
// the runtime checks dispatch on an EventTarget that stands in for window
// or document.

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  emitDocument,
  emitWindow,
  NOTIFY_EVENT,
  READY_EVENT,
  type UPNotifyDetail,
  WINDOW_STATE_EVENT,
} from "./events";
import type { UPPageWindowState } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function record(target: EventTarget, type: string): unknown[] {
  const details: unknown[] = [];
  target.addEventListener(type, (e) => details.push(e instanceof CustomEvent ? e.detail : e));
  return details;
}

describe("emitWindow", () => {
  it("dispatches the detail on window", () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const details = record(win, NOTIFY_EVENT);
    emitWindow(NOTIFY_EVENT, { summary: "Saved" });
    expect(details).toEqual([{ summary: "Saved" }]);
  });

  it("rejects a detail of the wrong type", () => {
    const wrong = () => {
      // @ts-expect-error -- a notification's detail is an object.
      emitWindow(NOTIFY_EVENT, 42);
      // @ts-expect-error -- visible is a boolean.
      emitWindow(WINDOW_STATE_EVENT, { visible: "yes", minimized: false, closed: false, maximized: false, focused: true });
    };
    expectTypeOf(wrong).returns.toBeVoid();
  });

  it("rejects an event that fires on document", () => {
    // @ts-expect-error -- up:ready fires on document.
    const wrong = () => emitWindow(READY_EVENT, null);
    expectTypeOf(wrong).returns.toBeVoid();
  });
});

describe("emitDocument", () => {
  it("dispatches the detail on document", () => {
    const doc = new EventTarget();
    vi.stubGlobal("document", doc);
    const details = record(doc, READY_EVENT);
    emitDocument(READY_EVENT, null);
    expect(details).toEqual([null]);
  });

  it("rejects an event that fires on window", () => {
    // @ts-expect-error -- up:notify fires on window.
    const wrong = () => emitDocument(NOTIFY_EVENT, { summary: "Saved" });
    expectTypeOf(wrong).returns.toBeVoid();
  });
});

describe("the DOM event maps", () => {
  it("give each listener the detail its event carries", () => {
    expectTypeOf<DocumentEventMap[typeof READY_EVENT]>().toEqualTypeOf<CustomEvent<null>>();
    expectTypeOf<WindowEventMap[typeof NOTIFY_EVENT]>().toEqualTypeOf<CustomEvent<UPNotifyDetail>>();
    expectTypeOf<WindowEventMap[typeof WINDOW_STATE_EVENT]>().toEqualTypeOf<CustomEvent<UPPageWindowState>>();
  });
});
