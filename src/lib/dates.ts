// Date helpers used by Today / History views and anywhere we bucket by day.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the local day containing `now` (milliseconds since epoch). */
export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** YYYY-MM-DD for the local day containing `now` — the snapshot/insight key. */
export function localDateKey(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export { DAY_MS };
