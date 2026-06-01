import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  ACTIVITY_CATEGORY_KEYS,
  SYMPTOM_CATEGORY_KEYS,
} from "./taxonomy";

const http = httpRouter();

// Strict enums on the HTTP boundary — if the agent sends an unknown category,
// reject it loudly so we don't silently store garbage.
const symptomCategoryEnum = z.enum(
  SYMPTOM_CATEGORY_KEYS as unknown as [string, ...string[]],
);
const activityCategoryEnum = z.enum(
  ACTIVITY_CATEGORY_KEYS as unknown as [string, ...string[]],
);

// Shape validation for incoming agent events. Discriminated union on `type`.
const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("transcript"),
    sessionId: z.string().min(1),
    role: z.union([z.literal("user"), z.literal("assistant")]),
    text: z.string().min(1),
  }),
  z.object({
    type: z.literal("symptom"),
    sessionId: z.string().min(1),
    category: symptomCategoryEnum,
    userWords: z.string().min(1),
    severity: z.number().min(1).max(5).optional(),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal("activity"),
    sessionId: z.string().min(1),
    category: activityCategoryEnum,
    userWords: z.string().min(1),
    exertion: z.number().min(1).max(5).optional(),
    durationMinutes: z.number().min(0).max(24 * 60).optional(),
  }),
  z.object({
    type: z.literal("session_context"),
    sessionId: z.string().min(1),
    sleepHours: z.number().min(0).max(14).optional(),
    hadPEMToday: z.boolean().optional(),
  }),
  // Mid-conversation corrections. Agent calls these when the user catches a
  // mistake. All fields except sessionId are optional patches.
  z.object({
    type: z.literal("correct_last_symptom"),
    sessionId: z.string().min(1),
    category: symptomCategoryEnum.optional(),
    userWords: z.string().min(1).optional(),
    severity: z.number().min(1).max(5).optional(),
    note: z.string().optional(),
  }),
  z.object({
    type: z.literal("correct_last_activity"),
    sessionId: z.string().min(1),
    category: activityCategoryEnum.optional(),
    userWords: z.string().min(1).optional(),
    exertion: z.number().min(1).max(5).optional(),
    durationMinutes: z.number().min(0).max(24 * 60).optional(),
  }),
  z.object({
    type: z.literal("finalize"),
    sessionId: z.string().min(1),
    summary: z.string().min(1),
    energyScore: z.number().min(1).max(5),
    flags: z.array(z.string()).optional(),
  }),
]);

http.route({
  path: "/agent-event",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sharedSecret = process.env.AGENT_SHARED_SECRET;
    if (!sharedSecret) {
      return new Response("AGENT_SHARED_SECRET not configured", {
        status: 500,
      });
    }
    const provided = req.headers.get("x-agent-secret");
    if (provided !== sharedSecret) {
      return new Response("unauthorized", { status: 401 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const parsed = AgentEventSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "validation failed", issues: parsed.error.issues }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    const event = parsed.data;
    const sessionId = event.sessionId as Id<"sessions">;

    // Verify the session exists before touching downstream tables.
    const session = await ctx.runQuery(internal.sessions.getInternal, {
      sessionId,
    });
    if (!session) {
      return new Response("session not found", { status: 404 });
    }

    switch (event.type) {
      case "transcript":
        await ctx.runMutation(internal.sessions.appendTranscript, {
          sessionId,
          role: event.role,
          text: event.text,
        });
        break;
      case "symptom":
        await ctx.runMutation(internal.sessions.recordSymptom, {
          sessionId,
          category: event.category,
          userWords: event.userWords,
          severity: event.severity,
          note: event.note,
        });
        break;
      case "activity":
        await ctx.runMutation(internal.sessions.recordActivity, {
          sessionId,
          category: event.category,
          userWords: event.userWords,
          exertion: event.exertion,
          durationMinutes: event.durationMinutes,
        });
        break;
      case "session_context":
        await ctx.runMutation(internal.sessions.recordSessionContext, {
          sessionId,
          sleepHours: event.sleepHours,
          hadPEMToday: event.hadPEMToday,
        });
        break;
      case "correct_last_symptom":
        await ctx.runMutation(internal.sessions.correctLastSymptom, {
          sessionId,
          category: event.category,
          userWords: event.userWords,
          severity: event.severity,
          note: event.note,
        });
        break;
      case "correct_last_activity":
        await ctx.runMutation(internal.sessions.correctLastActivity, {
          sessionId,
          category: event.category,
          userWords: event.userWords,
          exertion: event.exertion,
          durationMinutes: event.durationMinutes,
        });
        break;
      case "finalize":
        await ctx.runMutation(internal.sessions.finalize, {
          sessionId,
          summary: event.summary,
          energyScore: event.energyScore,
          flags: event.flags,
        });
        break;
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
});

export default http;
