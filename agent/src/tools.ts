// Tool handlers — each POSTs to the Convex /agent-event HTTP endpoint.

import type { ActivityCategory, SymptomCategory } from './taxonomy.js';

type Json = Record<string, unknown>;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function postEvent(body: Json) {
  const url = `${requireEnv("CONVEX_HTTP_URL").replace(/\/$/, "")}/agent-event`;
  const secret = requireEnv("AGENT_SHARED_SECRET");

  // Up to 3 attempts with exponential backoff. Server errors (5xx) and
  // network failures are retried; client errors (4xx) are not.
  const delays = [0, 250, 1000];
  let lastError: unknown = null;
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-secret": secret,
        },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
      // 4xx = our fault, no point retrying.
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => "");
        throw new Error(`agent-event ${res.status}: ${text}`);
      }
      // 5xx = retry
      lastError = new Error(`agent-event ${res.status}`);
    } catch (err) {
      // Network errors → retry. Non-retryable errors above re-throw directly.
      lastError = err;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("agent-event failed");
}

export async function appendTranscript(
  sessionId: string,
  role: "user" | "assistant",
  text: string,
) {
  if (!text.trim()) return;
  await postEvent({ type: "transcript", sessionId, role, text });
}

export async function recordSymptom(
  sessionId: string,
  args: {
    category: SymptomCategory;
    userWords: string;
    severity?: number;
    note?: string;
  },
) {
  await postEvent({ type: "symptom", sessionId, ...args });
}

export async function recordActivity(
  sessionId: string,
  args: {
    category: ActivityCategory;
    userWords: string;
    exertion?: number;
    durationMinutes?: number;
  },
) {
  await postEvent({ type: "activity", sessionId, ...args });
}

export async function correctLastSymptom(
  sessionId: string,
  args: {
    category?: SymptomCategory;
    userWords?: string;
    severity?: number;
    note?: string;
  },
) {
  await postEvent({ type: "correct_last_symptom", sessionId, ...args });
}

export async function correctLastActivity(
  sessionId: string,
  args: {
    category?: ActivityCategory;
    userWords?: string;
    exertion?: number;
    durationMinutes?: number;
  },
) {
  await postEvent({ type: "correct_last_activity", sessionId, ...args });
}

export async function recordSessionContext(
  sessionId: string,
  args: {
    sleepHours?: number;
    hadPEMToday?: boolean;
  },
) {
  if (args.sleepHours === undefined && args.hadPEMToday === undefined) return;
  await postEvent({ type: "session_context", sessionId, ...args });
}

export async function finalize(
  sessionId: string,
  args: {
    summary: string;
    energyScore: number;
    flags?: string[];
  },
) {
  await postEvent({ type: "finalize", sessionId, ...args });
}

// HealthKit snapshot — comes from the client via LiveKit participant metadata.
// Null fields mean "couldn't read" (no Apple Watch, denied permission,
// simulator, Android). The agent's get_health_context tool returns this
// shape; the prompt instructs the agent to skip references when fields are
// null. See HEALTHKIT.md for the full mapping.

export type HealthSnapshot = {
  hrvMs: number | null;
  hrvBaselineMs: number | null;
  restingHrBpm: number | null;
  sleepHoursLastNight: number | null;
  stepsYesterday: number | null;
};

const EMPTY_SNAPSHOT: HealthSnapshot = {
  hrvMs: null,
  hrvBaselineMs: null,
  restingHrBpm: null,
  sleepHoursLastNight: null,
  stepsYesterday: null,
};

/**
 * Returns the snapshot in the wire format the agent's tool surface uses.
 * Every field is included verbatim — `null` means "we couldn't read this".
 * The system prompt instructs the agent: "Do not reference any field that
 * is null." So no special-case marker is needed, and there's no risk of
 * tech-speak ("no HealthKit data available") leaking into the conversation.
 */
export function formatHealthContext(
  snapshot: HealthSnapshot | null | undefined,
): Record<string, unknown> {
  const s = snapshot ?? EMPTY_SNAPSHOT;
  return {
    hrv_ms: s.hrvMs,
    hrv_baseline_ms: s.hrvBaselineMs,
    resting_heart_rate_bpm: s.restingHrBpm,
    sleep_hours_last_night: s.sleepHoursLastNight,
    steps_yesterday: s.stepsYesterday,
  };
}
