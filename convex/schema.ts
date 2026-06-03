import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    deviceId: v.string(),
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
    severity: v.optional(v.number()), // 1–5
    note: v.optional(v.string()),
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
  })
    .index("by_device", ["deviceId"])
    .index("by_device_category", ["deviceId", "category"]),
});
