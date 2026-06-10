import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";

// Demo-scenario seeder for the class prototype. Writes a stable 7-day health
// baseline plus a "today" snapshot crafted to pin the deterministic PEM signal
// (convex/insights.ts) to a band: badDay trips three strong flags → red,
// goodDay trips none → green. Also seeds one completed check-in yesterday so
// the Stage-2 analyst has symptoms/activities to name a trigger from. Every
// seeded row carries `seeded: true` so clearScenario can remove demo data
// without touching the phone's real history. The insight itself is NOT written
// here — the client calls api.insights.analyzeToday afterwards, exercising the
// real analyst pipeline.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Date math on the key itself (timezone-safe — the key is the user's local
// day; shifting at UTC noon can never cross a day boundary).
function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function deleteSeeded(ctx: MutationCtx, deviceId: string) {
  let deleted = 0;

  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_device_started", (q) => q.eq("deviceId", deviceId))
    .order("desc")
    .take(500);
  for (const s of sessions) {
    if (s.seeded !== true) continue;
    // No transcripts are seeded, but clean up defensively in case one ever is.
    const transcripts = await ctx.db
      .query("transcriptMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", s._id))
      .take(500);
    for (const t of transcripts) await ctx.db.delete(t._id);
    await ctx.db.delete(s._id);
    deleted++;
  }

  const symptoms = await ctx.db
    .query("symptoms")
    .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
    .order("desc")
    .take(500);
  for (const s of symptoms) {
    if (s.seeded !== true) continue;
    await ctx.db.delete(s._id);
    deleted++;
  }

  const activities = await ctx.db
    .query("activities")
    .withIndex("by_device", (q) => q.eq("deviceId", deviceId))
    .order("desc")
    .take(500);
  for (const a of activities) {
    if (a.seeded !== true) continue;
    await ctx.db.delete(a._id);
    deleted++;
  }

  const snapshots = await ctx.db
    .query("healthSnapshots")
    .withIndex("by_device_date", (q) => q.eq("deviceId", deviceId))
    .order("desc")
    .take(500);
  for (const s of snapshots) {
    if (s.seeded !== true) continue;
    await ctx.db.delete(s._id);
    deleted++;
  }

  return deleted;
}

export const seedScenario = mutation({
  args: {
    deviceId: v.string(),
    // YYYY-MM-DD of the user's local day — the server has no timezone.
    dateKey: v.string(),
    scenario: v.union(v.literal("goodDay"), v.literal("badDay")),
  },
  handler: async (ctx, args) => {
    // Idempotent: wipe any previous seed first so re-running or switching
    // scenarios never stacks data.
    await deleteSeeded(ctx, args.deviceId);

    const bad = args.scenario === "badDay";
    const now = Date.now();

    // ── 7 prior days of stable, healthy snapshots (the personal baseline) ──
    // Insert only where no real row exists for that day, so the phone's real
    // history survives seeding and clearScenario restores it untouched.
    for (let i = 7; i >= 1; i--) {
      const dateKey = shiftDateKey(args.dateKey, -i);
      const existing = await ctx.db
        .query("healthSnapshots")
        .withIndex("by_device_date", (q) => q.eq("deviceId", args.deviceId).eq("dateKey", dateKey))
        .unique();
      if (existing) continue;
      await ctx.db.insert("healthSnapshots", {
        deviceId: args.deviceId,
        dateKey,
        hrvMs: 64 + (i % 4), // 64–67, quietly stable
        hrvBaselineMs: 65,
        restingHrBpm: 61 + (i % 3), // 61–63
        rhrBaseline7d: 62,
        sleepHours: 7.3 + (i % 5) * 0.1, // 7.3–7.7
        steps: 3200 + (i % 7) * 100, // 3200–3800
        capturedAt: now - i * DAY_MS,
        seeded: true,
      });
    }

    // ── Today's snapshot — the row the PEM signal actually reads ────────────
    // badDay: HRV −28% vs baseline (strong), RHR +9 bpm (strong), 4.4h sleep
    // (strong) → score 1.0 → red/high. goodDay: zero flags → 4.8 → green/low.
    const today = bad
      ? {
          hrvMs: 47,
          hrvBaselineMs: 65,
          restingHrBpm: 71,
          rhrBaseline7d: 62,
          sleepHours: 4.4,
          steps: 6800,
        }
      : {
          hrvMs: 66,
          hrvBaselineMs: 65,
          restingHrBpm: 61,
          rhrBaseline7d: 62,
          sleepHours: 7.6,
          steps: 3000,
        };
    const existingToday = await ctx.db
      .query("healthSnapshots")
      .withIndex("by_device_date", (q) =>
        q.eq("deviceId", args.deviceId).eq("dateKey", args.dateKey)
      )
      .unique();
    const todayDoc = {
      deviceId: args.deviceId,
      dateKey: args.dateKey,
      ...today,
      capturedAt: now,
      seeded: true,
    };
    if (existingToday) {
      await ctx.db.replace(existingToday._id, todayDoc);
    } else {
      await ctx.db.insert("healthSnapshots", todayDoc);
    }

    // ── One completed check-in yesterday + symptoms/activities ─────────────
    // startedAt −19h keeps it inside the analyst's 8-day window but clearly
    // yesterday. hadPEMToday stays false in BOTH scenarios: the PEM signal
    // reads the latest session's crash flag as "today", and the badDay red
    // must come purely from the wearable data.
    const sessionId = await ctx.db.insert("sessions", {
      deviceId: args.deviceId,
      startedAt: now - 19 * HOUR_MS,
      endedAt: now - 19 * HOUR_MS + 6 * 60 * 1000,
      status: "completed",
      energyScore: bad ? 2 : 4,
      sleepHours: bad ? 6.8 : 7.5,
      hadPEMToday: false,
      summary: bad
        ? "Long errand day — groceries and pharmacy, felt wiped by the evening."
        : "A quiet rest day with a short slow walk. Feeling steady.",
      seeded: true,
    });

    const symptoms: { category: string; userWords: string; severity: number }[] = bad
      ? [
          { category: "fatigue", userWords: "completely drained by the evening", severity: 4 },
          { category: "pem", userWords: "crashed on the sofa after the errands", severity: 4 },
          { category: "brain_fog", userWords: "couldn't follow my book", severity: 3 },
        ]
      : [
          {
            category: "fatigue",
            userWords: "a little tired in the afternoon, but okay",
            severity: 2,
          },
        ];
    for (const s of symptoms) {
      await ctx.db.insert("symptoms", {
        sessionId,
        deviceId: args.deviceId,
        ...s,
        seeded: true,
      });
    }

    const activities: {
      category: string;
      userWords: string;
      exertion: number;
      durationMinutes: number;
    }[] = bad
      ? [
          {
            category: "errand",
            userWords: "grocery run and pharmacy",
            exertion: 4,
            durationMinutes: 90,
          },
          {
            category: "household",
            userWords: "unpacking everything",
            exertion: 3,
            durationMinutes: 30,
          },
        ]
      : [
          {
            category: "rest",
            userWords: "mostly resting on the couch",
            exertion: 1,
            durationMinutes: 90,
          },
          {
            category: "walking",
            userWords: "short slow walk around the block",
            exertion: 2,
            durationMinutes: 15,
          },
        ];
    for (const a of activities) {
      await ctx.db.insert("activities", {
        sessionId,
        deviceId: args.deviceId,
        ...a,
        seeded: true,
      });
    }

    return { ok: true, scenario: args.scenario, dateKey: args.dateKey };
  },
});

export const clearScenario = mutation({
  args: {
    deviceId: v.string(),
    // Today's local day bounds (ms). Real check-ins recorded today (demo
    // rehearsals) are deleted along with the seeded rows so the device starts
    // the actual demo with a clean slate. The server has no timezone, so the
    // client supplies the window.
    dayStart: v.number(),
    dayEnd: v.number(),
  },
  handler: async (ctx, args) => {
    let deleted = await deleteSeeded(ctx, args.deviceId);

    // Today's REAL check-ins (not marked seeded — e.g. rehearsal voice calls):
    // delete the sessions plus their transcripts, symptoms, and activities.
    const todaysSessions = await ctx.db
      .query("sessions")
      .withIndex("by_device_started", (q) =>
        q.eq("deviceId", args.deviceId).gte("startedAt", args.dayStart).lt("startedAt", args.dayEnd)
      )
      .take(100);
    const sessionIds = new Set(todaysSessions.map((s) => s._id));
    if (sessionIds.size > 0) {
      const symptoms = await ctx.db
        .query("symptoms")
        .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
        .order("desc")
        .take(500);
      for (const s of symptoms) {
        if (!sessionIds.has(s.sessionId)) continue;
        await ctx.db.delete(s._id);
        deleted++;
      }
      const activities = await ctx.db
        .query("activities")
        .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
        .order("desc")
        .take(500);
      for (const a of activities) {
        if (!sessionIds.has(a.sessionId)) continue;
        await ctx.db.delete(a._id);
        deleted++;
      }
      for (const s of todaysSessions) {
        const transcripts = await ctx.db
          .query("transcriptMessages")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .take(500);
        for (const t of transcripts) await ctx.db.delete(t._id);
        await ctx.db.delete(s._id);
        deleted++;
      }
    }

    // Insights are fully regenerable (next check-in or "Analyze now"), so
    // dropping them all returns the device to a clean pre-demo state.
    const insights = await ctx.db
      .query("insights")
      .withIndex("by_device_date", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(500);
    for (const i of insights) await ctx.db.delete(i._id);

    return { ok: true, deleted: deleted + insights.length };
  },
});
