import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    deviceId: v.string(),
    // "en" | "de" — set at mint time; the Stage-2 analyst writes the insight
    // in this language. Optional: older rows predate the field.
    locale: v.optional(v.string()),
    // Local hour of day (0-23) at session start, set at mint time. The
    // post-check-in analyst derives its daypart from it (C6).
    localHour: v.optional(v.number()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
    energyScore: v.optional(v.number()),
    flags: v.optional(v.array(v.string())),
    // Structured context the agent gathers during the conversation.
    // Both optional — the agent may not get to either on a given day.
    sleepHours: v.optional(v.number()), // 0–14
    hadPEMToday: v.optional(v.boolean()),
    status: v.union(v.literal("active"), v.literal("completed"), v.literal("abandoned")),
    // True on rows written by the demo seeder (convex/debug.ts) so "Clear demo
    // data" can remove them without touching real history.
    seeded: v.optional(v.boolean()),
  })
    .index("by_device_started", ["deviceId", "startedAt"])
    .index("by_status_started", ["status", "startedAt"]),

  transcriptMessages: defineTable({
    sessionId: v.id("sessions"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    text: v.string(),
    at: v.number(),
  }).index("by_session", ["sessionId", "at"]),

  symptoms: defineTable({
    sessionId: v.id("sessions"),
    deviceId: v.string(),
    // Canonical taxonomy key — see convex/taxonomy.ts.
    category: v.string(),
    // The user's verbatim phrase, preserved so the History tab can quote.
    userWords: v.string(),
    severity: v.optional(v.number()), // 0–5; 0 = panel asked, not present today
    note: v.optional(v.string()),
    seeded: v.optional(v.boolean()),
  })
    .index("by_device", ["deviceId"])
    .index("by_device_category", ["deviceId", "category"]),

  activities: defineTable({
    sessionId: v.id("sessions"),
    deviceId: v.string(),
    category: v.string(),
    userWords: v.string(),
    exertion: v.optional(v.number()), // 1–5
    durationMinutes: v.optional(v.number()),
    seeded: v.optional(v.boolean()),
  })
    .index("by_device", ["deviceId"])
    .index("by_device_category", ["deviceId", "category"]),

  // One passive-health snapshot per device per local day. Written from the
  // client (Apple Health / Health Connect reads) on app open / after a check-in.
  // Baselines are the 7-day rolling averages used by the Stage-2 analyst + the
  // PEM signal. All metric fields are nullable — a watch may not report each one.
  healthSnapshots: defineTable({
    deviceId: v.string(),
    dateKey: v.string(), // YYYY-MM-DD, user's local day
    hrvMs: v.union(v.number(), v.null()),
    hrvBaselineMs: v.union(v.number(), v.null()),
    restingHrBpm: v.union(v.number(), v.null()),
    rhrBaseline7d: v.union(v.number(), v.null()),
    sleepHours: v.union(v.number(), v.null()),
    steps: v.union(v.number(), v.null()),
    capturedAt: v.number(),
    seeded: v.optional(v.boolean()),
  })
    .index("by_device_date", ["deviceId", "dateKey"])
    // Lets the daily cron scan only recently-captured snapshots instead of a
    // blind take(200) over the whole table.
    .index("by_captured", ["capturedAt"]),

  // One Stage-2 analyst output per device per local day. Written by the daily
  // cron, the manual "Re-analyze" trigger, and auto-scheduled after a check-in
  // finishes (convex/insights.ts). gpt-5.5 (high reasoning) produces a 1–5
  // Stability Score (Visible-style) + the narrative; the deterministic PEM
  // signal anchors it and is the offline fallback.
  insights: defineTable({
    deviceId: v.string(),
    dateKey: v.string(), // YYYY-MM-DD, user's local day
    // "gray" = not enough data yet (never falsely reassure with green).
    energyLevel: v.union(
      v.literal("green"),
      v.literal("yellow"),
      v.literal("red"),
      v.literal("gray")
    ),
    pemRisk: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    // 1.0–5.0 Stability Score; null when energyLevel is "gray".
    stabilityScore: v.optional(v.union(v.number(), v.null())),
    // Short transparency chips, e.g. "HRV 18% below baseline", "slept 4.5h".
    scoreDrivers: v.optional(v.array(v.string())),
    // Allow-list tags mapping to curated in-app research (see src/lib/evidence.ts).
    evidenceTags: v.optional(v.array(v.string())),
    summary: v.string(),
    topTrigger: v.optional(v.string()),
    recommendation: v.optional(v.string()),
    // The analyst's one-line internal justification — stored for debugging
    // and future evals, never rendered in the app.
    rationale: v.optional(v.string()),
    model: v.string(),
    // "analyzing" while the scheduled analyst runs, "ready" once written.
    // Optional so older rows (pre-field) remain schema-valid; treat missing as ready.
    status: v.optional(v.union(v.literal("analyzing"), v.literal("ready"))),
    // Cached OpenAI TTS audio of recommendation+summary. ttsText is the exact
    // text the audio was generated from — regenerate when the analyst rewrites it.
    ttsStorageId: v.optional(v.id("_storage")),
    ttsText: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_device_date", ["deviceId", "dateKey"]),

  // One per device: the personal context captured at onboarding, preprocessed
  // once by GPT-5.5 into a small profile that tunes both the voice agent and the
  // insights analyst. Optional and fail-open — a device with no row behaves as
  // before. careNote/adjustments/rawContext are in the user's locale.
  profiles: defineTable({
    deviceId: v.string(),
    rawContext: v.string(), // what the user typed, kept for re-runs / transparency
    // Taxonomy keys the person says they never have — hard-filtered from the panel.
    excludedSymptoms: v.array(v.string()),
    // ≤~300 chars of soft guidance folded into the agent + analyst prompts.
    careNote: v.string(),
    // 2–4 short user-facing bullets shown on the onboarding "tuning" screen.
    adjustments: v.array(v.string()),
    locale: v.string(),
    model: v.string(),
    updatedAt: v.number(),
  }).index("by_device", ["deviceId"]),
});
