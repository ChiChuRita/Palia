import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// How many prior days of history to draw a personal baseline from, and the
// minimum number of readings before we trust it. Research (Workwell, Visible,
// Altini/HRV4Training) favors a 14–30 day rolling window over 7 days: a single
// crash day shouldn't move the baseline. We EXCLUDE the current day so a low
// reading is compared against history, not against itself (which would mask
// the very dip we're trying to detect).
const BASELINE_WINDOW_DAYS = 30;
const BASELINE_MIN_READINGS = 4;

function rollingBaseline(values: number[]): number | null {
  if (values.length < BASELINE_MIN_READINGS) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

// Store today's passive-health snapshot (one row per device per local day).
// Called from the client after reading Apple Health / Health Connect. BOTH the
// HRV and resting-HR baselines are computed here from stored history (prior
// days only) so the Stage-2 analyst compares today against a stable personal
// normal. The client's own `hrvBaselineMs` arg is ignored once we have ≥4 days.
export const upsertSnapshot = mutation({
  args: {
    deviceId: v.string(),
    dateKey: v.string(), // YYYY-MM-DD, user's local day
    hrvMs: v.union(v.number(), v.null()),
    hrvBaselineMs: v.union(v.number(), v.null()),
    restingHrBpm: v.union(v.number(), v.null()),
    sleepHours: v.union(v.number(), v.null()),
    steps: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("healthSnapshots")
      .withIndex("by_device_date", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(BASELINE_WINDOW_DAYS + 1);

    // Prior days only (exclude today's own reading from its own baseline).
    const priorDays = recent.filter((s) => s.dateKey !== args.dateKey);

    const rhrValues = priorDays
      .map((s) => s.restingHrBpm)
      .filter((n): n is number => typeof n === "number");
    const rhrBaseline7d = rollingBaseline(rhrValues);

    // Server-computed HRV baseline from stored history. Fall back to the
    // client-supplied value only while we don't yet have enough stored days.
    const hrvValues = priorDays
      .map((s) => s.hrvMs)
      .filter((n): n is number => typeof n === "number");
    const hrvBaselineMs = rollingBaseline(hrvValues) ?? args.hrvBaselineMs;

    const doc = {
      deviceId: args.deviceId,
      dateKey: args.dateKey,
      hrvMs: args.hrvMs,
      hrvBaselineMs,
      restingHrBpm: args.restingHrBpm,
      rhrBaseline7d,
      sleepHours: args.sleepHours,
      steps: args.steps,
      capturedAt: Date.now(),
    };

    const existing = recent.find((s) => s.dateKey === args.dateKey);
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("healthSnapshots", doc);
  },
});

// Most recent stored snapshot for a device (for the Today view chips).
export const latestSnapshot = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("healthSnapshots")
      .withIndex("by_device_date", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .first();
  },
});
