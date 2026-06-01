import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

export const start = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert("sessions", {
      deviceId: args.deviceId,
      startedAt: Date.now(),
      status: "active",
    });
    return sessionId;
  },
});

export const appendTranscript = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("transcriptMessages", {
      sessionId: args.sessionId,
      role: args.role,
      text: args.text,
      at: Date.now(),
    });
  },
});

export const recordSymptom = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    category: v.string(),
    userWords: v.string(),
    severity: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    await ctx.db.insert("symptoms", {
      sessionId: args.sessionId,
      deviceId: session.deviceId,
      category: args.category,
      userWords: args.userWords,
      severity: args.severity,
      note: args.note,
    });
  },
});

export const recordActivity = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    category: v.string(),
    userWords: v.string(),
    exertion: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    await ctx.db.insert("activities", {
      sessionId: args.sessionId,
      deviceId: session.deviceId,
      category: args.category,
      userWords: args.userWords,
      exertion: args.exertion,
      durationMinutes: args.durationMinutes,
    });
  },
});

// Session context — sleep + PEM only. Mid-conversation patch onto the session.
// Note: schema still has sleepQuality/mood/pacingNote as optional fields from
// an earlier iteration; we no longer write them but keep schema-compatible
// for existing rows. Drop from schema when convenient.
export const recordSessionContext = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    sleepHours: v.optional(v.number()),
    hadPEMToday: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;
    const patch: Record<string, unknown> = {};
    if (args.sleepHours !== undefined) patch.sleepHours = args.sleepHours;
    if (args.hadPEMToday !== undefined) patch.hadPEMToday = args.hadPEMToday;
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(args.sessionId, patch);
  },
});

// Mid-conversation correction tools for the agent. The agent calls these
// when the user catches a mistake ("actually it was a 2 not a 4", "no, not
// fatigue — that was a crash"). Both find the most recent symptom/activity
// in the current session and patch the provided fields. Any field omitted
// is left unchanged.

export const correctLastSymptom = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    category: v.optional(v.string()),
    userWords: v.optional(v.string()),
    severity: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    // Most-recent symptom for THIS session. Cheaper than indexing on
    // sessionId since one user has at most ~10 symptoms per session.
    const all = await ctx.db
      .query("symptoms")
      .withIndex("by_device", (q) => q.eq("deviceId", session.deviceId))
      .order("desc")
      .take(50);
    const last = all.find((s) => s.sessionId === args.sessionId);
    if (!last) return null;
    const patch: Record<string, unknown> = {};
    if (args.category !== undefined) patch.category = args.category;
    if (args.userWords !== undefined) patch.userWords = args.userWords;
    if (args.severity !== undefined) patch.severity = args.severity;
    if (args.note !== undefined) patch.note = args.note;
    if (Object.keys(patch).length === 0) return last._id;
    await ctx.db.patch(last._id, patch);
    return last._id;
  },
});

export const correctLastActivity = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    category: v.optional(v.string()),
    userWords: v.optional(v.string()),
    exertion: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return null;
    const all = await ctx.db
      .query("activities")
      .withIndex("by_device", (q) => q.eq("deviceId", session.deviceId))
      .order("desc")
      .take(50);
    const last = all.find((a) => a.sessionId === args.sessionId);
    if (!last) return null;
    const patch: Record<string, unknown> = {};
    if (args.category !== undefined) patch.category = args.category;
    if (args.userWords !== undefined) patch.userWords = args.userWords;
    if (args.exertion !== undefined) patch.exertion = args.exertion;
    if (args.durationMinutes !== undefined)
      patch.durationMinutes = args.durationMinutes;
    if (Object.keys(patch).length === 0) return last._id;
    await ctx.db.patch(last._id, patch);
    return last._id;
  },
});

// ───────────────────────────────────────────────────────────────────────────
// Client-facing edit mutations — the user taps a row in the History tab.
// Authorization model: deviceId match. This is a single-user prototype with
// no auth; in production this would be replaced with userId from auth ctx.
// ───────────────────────────────────────────────────────────────────────────

export const editSymptom = mutation({
  args: {
    symptomId: v.id("symptoms"),
    deviceId: v.string(),
    category: v.optional(v.string()),
    severity: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.symptomId);
    if (!row || row.deviceId !== args.deviceId) return;
    const patch: Record<string, unknown> = {};
    if (args.category !== undefined) patch.category = args.category;
    if (args.severity !== undefined) patch.severity = args.severity;
    if (args.note !== undefined) patch.note = args.note;
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(args.symptomId, patch);
  },
});

export const deleteSymptom = mutation({
  args: { symptomId: v.id("symptoms"), deviceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.symptomId);
    if (!row || row.deviceId !== args.deviceId) return;
    await ctx.db.delete(args.symptomId);
  },
});

export const editActivity = mutation({
  args: {
    activityId: v.id("activities"),
    deviceId: v.string(),
    category: v.optional(v.string()),
    exertion: v.optional(v.number()),
    durationMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.activityId);
    if (!row || row.deviceId !== args.deviceId) return;
    const patch: Record<string, unknown> = {};
    if (args.category !== undefined) patch.category = args.category;
    if (args.exertion !== undefined) patch.exertion = args.exertion;
    if (args.durationMinutes !== undefined)
      patch.durationMinutes = args.durationMinutes;
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(args.activityId, patch);
  },
});

export const deleteActivity = mutation({
  args: { activityId: v.id("activities"), deviceId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.activityId);
    if (!row || row.deviceId !== args.deviceId) return;
    await ctx.db.delete(args.activityId);
  },
});

export const editSessionScore = mutation({
  args: {
    sessionId: v.id("sessions"),
    deviceId: v.string(),
    energyScore: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.sessionId);
    if (!row || row.deviceId !== args.deviceId) return;
    await ctx.db.patch(args.sessionId, { energyScore: args.energyScore });
  },
});

export const listSymptomsForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return [];
    const all = await ctx.db
      .query("symptoms")
      .withIndex("by_device", (q) => q.eq("deviceId", session.deviceId))
      .order("desc")
      .take(100);
    return all.filter((s) => s.sessionId === args.sessionId);
  },
});

export const listActivitiesForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return [];
    const all = await ctx.db
      .query("activities")
      .withIndex("by_device", (q) => q.eq("deviceId", session.deviceId))
      .order("desc")
      .take(100);
    return all.filter((a) => a.sessionId === args.sessionId);
  },
});

export const finalize = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    summary: v.string(),
    energyScore: v.number(),
    flags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      endedAt: Date.now(),
      summary: args.summary,
      energyScore: args.energyScore,
      flags: args.flags,
      status: "completed",
    });
  },
});

export const markAbandoned = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status !== "active") return;
    await ctx.db.patch(args.sessionId, {
      endedAt: Date.now(),
      status: "abandoned",
    });
  },
});

export const getInternal = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

// Reaper for orphan "active" sessions: when a client disconnects without
// calling end_session (network drop, force-quit, crash) the session would
// otherwise stay active forever. Run from a cron every 5 minutes.
export const reapStaleActive = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
    const stale = await ctx.db
      .query("sessions")
      .withIndex("by_status_started", (q) =>
        q.eq("status", "active").lt("startedAt", cutoff),
      )
      .take(50);
    for (const s of stale) {
      await ctx.db.patch(s._id, {
        endedAt: Date.now(),
        status: "abandoned",
      });
    }
    return stale.length;
  },
});

export const listForDevice = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_device_started", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(20);
  },
});

export const listSymptomsForDevice = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("symptoms")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(50);
  },
});

export const listActivitiesForDevice = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("activities")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(50);
  },
});

export const listTranscriptForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("transcriptMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(200);
  },
});

// "Today" snapshot — most recent completed session today + most recent yesterday.
// Client passes timezone-localized day boundaries.
export const todaySnapshot = query({
  args: {
    deviceId: v.string(),
    dayStart: v.number(), // ms, start of user's local "today"
    dayEnd: v.number(), // ms, end of user's local "today"
  },
  handler: async (ctx, args) => {
    const todays = await ctx.db
      .query("sessions")
      .withIndex("by_device_started", (q) =>
        q
          .eq("deviceId", args.deviceId)
          .gte("startedAt", args.dayStart)
          .lt("startedAt", args.dayEnd),
      )
      .order("desc")
      .take(50);
    const yesterdayStart = args.dayStart - 24 * 60 * 60 * 1000;
    const yesterdays = await ctx.db
      .query("sessions")
      .withIndex("by_device_started", (q) =>
        q
          .eq("deviceId", args.deviceId)
          .gte("startedAt", yesterdayStart)
          .lt("startedAt", args.dayStart),
      )
      .order("desc")
      .take(50);

    const todayCompleted = todays.find((s) => s.status === "completed") ?? null;
    const yesterdayCompleted =
      yesterdays.find((s) => s.status === "completed") ?? null;

    return {
      today: todayCompleted,
      yesterday: yesterdayCompleted,
      lastCheckInAt: todays[0]?.startedAt ?? yesterdays[0]?.startedAt ?? null,
    };
  },
});

// Top symptoms + activities over the last N days for the device.
// Aggregated by canonical category, not by free-text — so synonyms collapse.
export const weeklyAggregates = query({
  args: { deviceId: v.string(), sinceMs: v.number() },
  handler: async (ctx, args) => {
    // Fetch with broad bounds; filter in-memory on _creationTime. Bounded by
    // .take(200), which is plenty for one user's last 7 days.
    const symptoms = await ctx.db
      .query("symptoms")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(200);
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(200);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_device_started", (q) =>
        q.eq("deviceId", args.deviceId).gte("startedAt", args.sinceMs),
      )
      .order("desc")
      .take(200);

    const recentSym = symptoms.filter((s) => s._creationTime >= args.sinceMs);
    const recentAct = activities.filter((a) => a._creationTime >= args.sinceMs);
    const recentCompleted = sessions.filter((s) => s.status === "completed");

    type SymAgg = {
      category: string;
      count: number;
      severities: number[];
      sampleWords: string[];
    };
    type ActAgg = {
      category: string;
      count: number;
      exertions: number[];
      sampleWords: string[];
    };

    const symMap = new Map<string, SymAgg>();
    for (const s of recentSym) {
      const e = symMap.get(s.category) ?? {
        category: s.category,
        count: 0,
        severities: [],
        sampleWords: [],
      };
      e.count++;
      if (s.severity != null) e.severities.push(s.severity);
      // Keep up to 3 verbatim phrases — shown as supporting quotes in UI.
      if (e.sampleWords.length < 3 && s.userWords) {
        e.sampleWords.push(s.userWords);
      }
      symMap.set(s.category, e);
    }

    const actMap = new Map<string, ActAgg>();
    for (const a of recentAct) {
      const e = actMap.get(a.category) ?? {
        category: a.category,
        count: 0,
        exertions: [],
        sampleWords: [],
      };
      e.count++;
      if (a.exertion != null) e.exertions.push(a.exertion);
      if (e.sampleWords.length < 3 && a.userWords) {
        e.sampleWords.push(a.userWords);
      }
      actMap.set(a.category, e);
    }

    const avg = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

    const sleepHoursValues = recentCompleted
      .map((s) => s.sleepHours)
      .filter((v): v is number => typeof v === "number");
    const pemDays = recentCompleted.filter((s) => s.hadPEMToday === true).length;

    return {
      symptoms: Array.from(symMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
        .map((s) => ({
          category: s.category,
          count: s.count,
          avgSeverity: avg(s.severities),
          sampleWords: s.sampleWords,
        })),
      activities: Array.from(actMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
        .map((a) => ({
          category: a.category,
          count: a.count,
          avgExertion: avg(a.exertions),
          sampleWords: a.sampleWords,
        })),
      sleep: {
        avgHours: avg(sleepHoursValues),
        nights: sleepHoursValues.length,
      },
      pemDays,
    };
  },
});

// Rest streak: consecutive days ending today with at least one completed
// session whose energyScore is >= 3. "Days" are bucketed by the client's
// dayLengthMs (24h) starting at the client-supplied nowMs.
export const restStreak = query({
  args: {
    deviceId: v.string(),
    nowMs: v.number(),
    dayLengthMs: v.number(),
  },
  handler: async (ctx, args) => {
    const lookback = args.nowMs - 60 * args.dayLengthMs; // up to 60 days back
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_device_started", (q) =>
        q.eq("deviceId", args.deviceId).gte("startedAt", lookback),
      )
      .order("desc")
      .take(300);

    const goodDays = new Set<number>();
    for (const s of sessions) {
      if (s.status !== "completed") continue;
      if ((s.energyScore ?? 0) < 3) continue;
      goodDays.add(Math.floor(s.startedAt / args.dayLengthMs));
    }

    const todayBucket = Math.floor(args.nowMs / args.dayLengthMs);
    let streak = 0;
    let day = todayBucket;
    // Allow the streak to start today OR yesterday (so it doesn't reset just
    // because the user hasn't checked in yet on the current day).
    if (!goodDays.has(day)) day -= 1;
    while (goodDays.has(day)) {
      streak++;
      day--;
    }
    return streak;
  },
});

// ───────────────────────────────────────────────────────────────────────────
// DEV: wipe all user-generated data. Call from the Convex dashboard
// (Functions → sessions:dangerouslyWipeAll → Run) or via:
//   npx convex run sessions:dangerouslyWipeAll
// Never expose this in production.
// ───────────────────────────────────────────────────────────────────────────
export const dangerouslyWipeAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    let counts = { sessions: 0, symptoms: 0, activities: 0, transcripts: 0 };
    for await (const row of ctx.db.query("symptoms")) {
      await ctx.db.delete(row._id);
      counts.symptoms++;
    }
    for await (const row of ctx.db.query("activities")) {
      await ctx.db.delete(row._id);
      counts.activities++;
    }
    for await (const row of ctx.db.query("transcriptMessages")) {
      await ctx.db.delete(row._id);
      counts.transcripts++;
    }
    for await (const row of ctx.db.query("sessions")) {
      await ctx.db.delete(row._id);
      counts.sessions++;
    }
    return counts;
  },
});
