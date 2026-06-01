// Date helpers used by Today / History views and anywhere we bucket by day.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the local day containing `now` (milliseconds since epoch). */
export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export { DAY_MS };
