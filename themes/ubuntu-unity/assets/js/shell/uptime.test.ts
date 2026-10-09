import { describe, it, expect } from "vitest";
import { formatUptime } from "./uptime";

describe("formatUptime", () => {
  const cases: [string, string, string][] = [
    ["1996-10-03", "2026-10-08T12:00:00Z", "30 years, 5 days"],
    ["1996-10-03", "2026-10-03T00:00:00Z", "30 years, 0 days"],
    ["1996-10-03", "2026-10-02T23:59:59Z", "29 years, 364 days"],
    ["1996-10-03", "2024-10-02T12:00:00Z", "27 years, 365 days"], // leap year
    ["2026-01-01", "2026-10-08T00:00:00Z", "280 days"],
    ["2026-10-08", "2026-10-08T09:00:00Z", "0 days"],
    ["2027-01-01", "2026-10-08T00:00:00Z", "0 days"], // future
    ["", "2026-10-08T00:00:00Z", "0 days"],
    ["not a date", "2026-10-08T00:00:00Z", "0 days"],
  ];
  for (const [since, now, want] of cases) {
    it(`${since || "(empty)"} at ${now} -> ${want}`, () => {
      expect(formatUptime(since, new Date(now))).toBe(want);
    });
  }
});
