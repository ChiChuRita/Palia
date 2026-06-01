"use node";

import { v } from "convex/values";
import { AccessToken } from "livekit-server-sdk";
import { api } from "./_generated/api";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// Health snapshot validator — kept loose (all optional) so the action accepts
// a partial payload even if some HealthKit reads fail on the client.
const healthSnapshotValidator = v.object({
  hrvMs: v.union(v.number(), v.null()),
  hrvBaselineMs: v.union(v.number(), v.null()),
  restingHrBpm: v.union(v.number(), v.null()),
  sleepHoursLastNight: v.union(v.number(), v.null()),
  stepsYesterday: v.union(v.number(), v.null()),
});

export const mintToken = action({
  args: {
    deviceId: v.string(),
    // ISO 639-1 (e.g. "en", "de"). Optional; agent falls back to English.
    locale: v.optional(v.string()),
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
        "LiveKit env vars missing: set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET via `npx convex env set`",
      );
    }

    const sessionId: Id<"sessions"> = await ctx.runMutation(
      api.sessions.start,
      { deviceId: args.deviceId },
    );

    const at = new AccessToken(apiKey, apiSecret, {
      identity: args.deviceId,
      ttl: 60 * 10,
      // Stash locale + health snapshot in token metadata. Agent reads it
      // from participant.metadata on the agent side.
      metadata: JSON.stringify({
        locale: args.locale ?? "en",
        healthSnapshot: args.healthSnapshot ?? null,
      }),
    });
    at.addGrant({
      roomJoin: true,
      room: sessionId,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    return { token, url, sessionId };
  },
});
