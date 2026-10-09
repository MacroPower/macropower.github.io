const DAY_MS = 86_400_000;

// Formats the time from `since` (a YYYY-MM-DD date, read as UTC midnight) to
// `now` as "N years, N days", or "N days" under a year. Counting days from the
// last anniversary keeps the result leap-year exact. An empty, malformed, or
// future `since` gives "0 days".
export function formatUptime(since: string, now: Date): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(since);
  if (!m) return "0 days";
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const t = now.getTime();

  let years = now.getUTCFullYear() - Number(m[1]);
  let anniversary = Date.UTC(now.getUTCFullYear(), month, day);
  if (t < anniversary) {
    years -= 1;
    anniversary = Date.UTC(now.getUTCFullYear() - 1, month, day);
  }
  if (years < 0) return "0 days";

  const days = Math.floor((t - anniversary) / DAY_MS);
  return years < 1 ? `${days} days` : `${years} years, ${days} days`;
}
