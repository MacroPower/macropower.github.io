import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { safeNavUrl, webUrl } from "./url";

const BASE = "https://example.org/posts/";

// Each refusal warns once, and nothing else warns.
let warn: MockInstance<typeof console.warn>;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

describe("safeNavUrl", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "vbscript:msgbox(1)",
    "VBScript:msgbox(1)",
    "data:text/html,<script>alert(1)</script>",
    "Data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "http://[",
  ])("refuses %j with a warning", (url) => {
    expect(safeNavUrl(url, BASE)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([
    "https://example.net/",
    "http://example.net/page",
    "/projects/",
    "about/",
    "?q=1",
    "#top",
    "//example.net/x",
    "tel:+15551234",
    "mailto:me@example.org",
  ])("passes %j through", (url) => {
    expect(safeNavUrl(url, BASE)).toBe(url);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("webUrl", () => {
  it.each([
    "https://github.com/me/site",
    "http://example.net/",
    "/source/",
  ])("passes %j through", (url) => {
    expect(webUrl(url, BASE)).toBe(url);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,x",
    "tel:+15551234",
    "mailto:me@example.org",
    "ftp://example.net/",
    "http://[",
  ])("refuses %j with a warning", (url) => {
    expect(webUrl(url, BASE)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});
