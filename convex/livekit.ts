"use node";

import { v } from "convex/values";
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";
import { api, internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Health snapshot validator — kept loose (all optional) so the action accepts
// a partial payload even if some HealthKit reads fail on the client.
const healthSnapshotValidator = v.object({
  hrvMs: v.union(v.number(), v.null()),
  hrvBaselineMs: v.union(v.number(), v.null()),
  restingHrBpm: v.union(v.number(), v.null()),
  // 7-day resting-HR baseline — only the stored Convex snapshot has it (the
  // baseline is server-computed), so it's optional on the wire.
  rhrBaseline7d: v.optional(v.union(v.number(), v.null())),
  sleepHoursLastNight: v.union(v.number(), v.null()),
  stepsToday: v.union(v.number(), v.null()),
  stepsYesterday: v.union(v.number(), v.null()),
});

export const mintToken = action({
  args: {
    deviceId: v.string(),
    // ISO 639-1 (e.g. "en", "de"). Optional; agent falls back to English.
    locale: v.optional(v.string()),
    // Bot Lab variant id ("A".."E"). Optional; agent falls back to default.
    variant: v.optional(v.string()),
    // Optional HealthKit snapshot. Passed through to the agent via the
    // LiveKit participant metadata channel.
    healthSnapshot: v.optional(healthSnapshotValidator),
  },
  handler: async (ctx, args) => {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
      throw new Error(
        "LiveKit env vars missing: set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET via `npx convex env set`"
      );
    }

    const sessionId: Id<"sessions"> = await ctx.runMutation(api.sessions.start, {
      deviceId: args.deviceId,
    });

    // The user's recurring symptoms (last 14 days) — the agent asks these by
    // name every day so symptom data is a dense daily series, not volunteer-
    // only sparse mentions.
    const symptomPanel: string[] = await ctx.runQuery(
      internal.sessions.topSymptomCategoriesForDevice,
      { deviceId: args.deviceId, sinceMs: Date.now() - 14 * 24 * 60 * 60 * 1000 }
    );

    const at = new AccessToken(apiKey, apiSecret, {
      identity: args.deviceId,
      ttl: 60 * 10,
      // Stash locale + health snapshot in token metadata. Agent reads it
      // from participant.metadata on the agent side.
      metadata: JSON.stringify({
        locale: args.locale ?? "en",
        variant: args.variant ?? null,
        healthSnapshot: args.healthSnapshot ?? null,
        symptomPanel,
      }),
    });
    at.addGrant({
      roomJoin: true,
      room: sessionId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    // PROD ONLY: explicitly dispatch the named cloud agent into this room.
    // The prod Convex deployment sets AGENT_NAME; dev deployments leave it
    // unset, so dev rooms fall back to automatic dispatch and the local
    // `tsx watch` worker picks them up. Named cloud agents are excluded from
    // automatic dispatch, so they can never steal dev rooms.
    const agentName = process.env.AGENT_NAME;
    if (agentName) {
      at.roomConfig = new RoomConfiguration({
        agents: [new RoomAgentDispatch({ agentName })],
      });
    }

    const token = await at.toJwt();
    return { token, url, sessionId };
  },
});
