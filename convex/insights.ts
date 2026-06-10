import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";

const DAY_MS = 24 * 60 * 60 * 1000;

type Snapshot = {
  dateKey: string;
  hrvMs: number | null;
  hrvBaselineMs: number | null;
  restingHrBpm: number | null;
  rhrBaseline7d: number | null;
  sleepHours: number | null;
  steps: number | null;
};

type EnergyLevel = "green" | "yellow" | "red" | "gray";
type PemRisk = "low" | "medium" | "high";

// Allow-list of evidence tags. The LLM may only cite these; anything else is
// dropped server-side. Each maps to a curated research entry in
// src/lib/evidence.ts — we never let the model emit URLs or study names.
const EVIDENCE_TAGS = [
  "hrv_pacing",
  "rhr_strain",
  "sleep_quality",
  "energy_envelope",
  "pem_avoidance",
  "pacing_general",
] as const;
type EvidenceTag = (typeof EVIDENCE_TAGS)[number];
const EVIDENCE_TAG_SET = new Set<string>(EVIDENCE_TAGS);

type AnalystResult = {
  energyLevel: EnergyLevel;
  pemRisk: PemRisk;
  stabilityScore: number | null; // 1.0–5.0, null when gray
  scoreDrivers: string[];
  evidenceTags: EvidenceTag[];
  summary: string;
  topTrigger?: string;
  recommendation?: string;
};

// ── Read side: everything the analyst needs, in one query ──────────────────
export const gatherContext = internalQuery({
  args: { deviceId: v.string(), sinceMs: v.number() },
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query("healthSnapshots")
      .withIndex("by_device_date", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(30);
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_device_started", (q) =>
        q.eq("deviceId", args.deviceId).gte("startedAt", args.sinceMs)
      )
      .order("desc")
      .take(14);
    const symptoms = await ctx.db
      .query("symptoms")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(40);
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .take(40);
    return { snapshots, sessions, symptoms, activities };
  },
});

// ── Write side: upsert one insight per device per day ──────────────────────
export const writeInsight = internalMutation({
  args: {
    deviceId: v.string(),
    dateKey: v.string(),
    energyLevel: v.union(
      v.literal("green"),
      v.literal("yellow"),
      v.literal("red"),
      v.literal("gray")
    ),
    pemRisk: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    stabilityScore: v.union(v.number(), v.null()),
    scoreDrivers: v.array(v.string()),
    evidenceTags: v.array(v.string()),
    summary: v.string(),
    topTrigger: v.optional(v.string()),
    recommendation: v.optional(v.string()),
    model: v.string(),
    status: v.union(v.literal("analyzing"), v.literal("ready")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("insights")
      .withIndex("by_device_date", (q) =>
        q.eq("deviceId", args.deviceId).eq("dateKey", args.dateKey)
      )
      .first();
    // ctx.db.replace would drop fields; for the upsert we want a full overwrite
    // of the analyst output (review bug: patch left stale fields behind).
    const doc = {
      deviceId: args.deviceId,
      dateKey: args.dateKey,
      energyLevel: args.energyLevel,
      pemRisk: args.pemRisk,
      stabilityScore: args.stabilityScore,
      scoreDrivers: args.scoreDrivers,
      evidenceTags: args.evidenceTags,
      summary: args.summary,
      topTrigger: args.topTrigger,
      recommendation: args.recommendation,
      model: args.model,
      status: args.status,
      createdAt: Date.now(),
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("insights", doc);
  },
});

// Mark today's insight as "analyzing" so the Insights screen can show a live
// "reading your day…" state. Preserves any prior fields; this is a placeholder
// the scheduled analyst overwrites. Exported as a helper so finalize() (a
// mutation, which can't ctx.runMutation) can call it directly.
export async function markInsightAnalyzing(
  ctx: MutationCtx,
  deviceId: string,
  dateKey: string
): Promise<void> {
  const existing = await ctx.db
    .query("insights")
    .withIndex("by_device_date", (q) =>
      q.eq("deviceId", deviceId).eq("dateKey", dateKey)
    )
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { status: "analyzing" });
    return;
  }
  await ctx.db.insert("insights", {
    deviceId,
    dateKey,
    energyLevel: "gray",
    pemRisk: "low",
    stabilityScore: null,
    scoreDrivers: [],
    evidenceTags: [],
    summary: "",
    model: "pending",
    status: "analyzing",
    createdAt: Date.now(),
  });
}

// Latest insight for the Today view + Insights tab.
export const latestInsight = query({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("insights")
      .withIndex("by_device_date", (q) => q.eq("deviceId", args.deviceId))
      .order("desc")
      .first();
  },
});

// Devices that logged a snapshot recently — used by the daily cron.
export const recentDevices = internalQuery({
  args: { sinceMs: v.number() },
  handler: async (ctx, args) => {
    const snaps = await ctx.db
      .query("healthSnapshots")
      .withIndex("by_captured", (q) => q.gte("capturedAt", args.sinceMs))
      .order("desc")
      .take(500);
    const ids = new Set<string>();
    for (const s of snaps) ids.add(s.deviceId);
    return [...ids];
  },
});

// ── The PEM signal (deterministic) — both an LLM anchor and an offline fallback ──
//
// Research-tuned thresholds (Workwell Foundation; Altini/HRV4Training; ME
// Association 2025 HRM-pacing study; NICE NG206):
//   • HRV ↓15–20% vs baseline = mild flag, >20% = strong.
//   • Resting HR +5–8 bpm absolute vs baseline = mild, >8 bpm = strong.
//     (Absolute bpm, not %, because a 5% delta off a low RHR is noise.)
//   • Sleep <6h = mild, <5h = strong; a mild sleep flag escalates to strong
//     when the user reports unrefreshing sleep or a crash.
//   • A self-reported crash today (hadPEMToday) is a strong flag on its own.
// Null baselines never produce a flag (we don't guess on sparse data).
type FactorStatus = "ok" | "mild" | "strong" | "insufficient";
type Signal = {
  hasHealth: boolean;
  factors: {
    hrv: { status: FactorStatus; deltaPct: number | null };
    rhr: { status: FactorStatus; deltaBpm: number | null };
    sleep: { status: FactorStatus; hours: number | null };
    pem: { flag: boolean };
  };
  drivers: string[];
  tags: EvidenceTag[];
  fallback: AnalystResult;
};

function bandFromScore(score: number | null): { energyLevel: EnergyLevel; pemRisk: PemRisk } {
  if (score == null) return { energyLevel: "gray", pemRisk: "low" };
  if (score >= 4) return { energyLevel: "green", pemRisk: "low" };
  if (score >= 2.5) return { energyLevel: "yellow", pemRisk: "medium" };
  return { energyLevel: "red", pemRisk: "high" };
}

function clampScore(n: number): number {
  return Math.max(1, Math.min(5, Math.round(n * 10) / 10));
}

function computePemSignal(
  s: Snapshot | null,
  extras: { hadPEMToday?: boolean; unrefreshingSleep?: boolean }
): Signal {
  const drivers: string[] = [];
  const tags = new Set<EvidenceTag>();
  let deduction = 0; // points off a 4.8 "good day" baseline

  const hrvKnown = !!(s && s.hrvMs != null && s.hrvBaselineMs != null && s.hrvBaselineMs > 0);
  let hrvStatus: FactorStatus = hrvKnown ? "ok" : "insufficient";
  let hrvDeltaPct: number | null = null;
  if (hrvKnown && s) {
    hrvDeltaPct = Math.round(((s.hrvBaselineMs! - s.hrvMs!) / s.hrvBaselineMs!) * 100);
    if (hrvDeltaPct > 20) {
      hrvStatus = "strong";
      deduction += 1.6;
      drivers.push(`heart recovery (HRV) ${hrvDeltaPct}% below your usual`);
      tags.add("hrv_pacing");
    } else if (hrvDeltaPct >= 15) {
      hrvStatus = "mild";
      deduction += 0.8;
      drivers.push(`heart recovery (HRV) ${hrvDeltaPct}% below your usual`);
      tags.add("hrv_pacing");
    }
  }

  const rhrKnown = !!(s && s.restingHrBpm != null && s.rhrBaseline7d != null);
  let rhrStatus: FactorStatus = rhrKnown ? "ok" : "insufficient";
  let rhrDeltaBpm: number | null = null;
  if (rhrKnown && s) {
    rhrDeltaBpm = Math.round(s.restingHrBpm! - s.rhrBaseline7d!);
    if (rhrDeltaBpm > 8) {
      rhrStatus = "strong";
      deduction += 1.6;
      drivers.push(`resting heart rate ${rhrDeltaBpm} beats above your usual`);
      tags.add("rhr_strain");
    } else if (rhrDeltaBpm >= 5) {
      rhrStatus = "mild";
      deduction += 0.8;
      drivers.push(`resting heart rate ${rhrDeltaBpm} beats above your usual`);
      tags.add("rhr_strain");
    }
  }

  const sleepKnown = !!(s && s.sleepHours != null);
  let sleepStatus: FactorStatus = sleepKnown ? "ok" : "insufficient";
  const sleepHours = sleepKnown && s ? s.sleepHours : null;
  if (sleepKnown && s && s.sleepHours != null) {
    const h = s.sleepHours;
    if (h < 5) {
      sleepStatus = "strong";
      deduction += 1.6;
      drivers.push(`only ${h.toFixed(1)} hours of sleep`);
      tags.add("sleep_quality");
    } else if (h < 6) {
      sleepStatus = extras.unrefreshingSleep ? "strong" : "mild";
      deduction += extras.unrefreshingSleep ? 1.6 : 0.8;
      drivers.push(
        extras.unrefreshingSleep
          ? `${h.toFixed(1)} hours of unrefreshing sleep`
          : `${h.toFixed(1)} hours of sleep`
      );
      tags.add("sleep_quality");
    }
  }

  const pemFlag = extras.hadPEMToday === true;
  if (pemFlag) {
    deduction += 1.6;
    drivers.push("you reported a crash today");
    tags.add("pem_avoidance");
  }

  // No wearable data at all (and the caller confirmed no check-in content):
  // never falsely reassure with green. Return a gray "not enough data" read.
  const hasHealth = hrvKnown || rhrKnown || sleepKnown;

  if (!hasHealth && !pemFlag) {
    return {
      hasHealth,
      factors: {
        hrv: { status: "insufficient", deltaPct: null },
        rhr: { status: "insufficient", deltaBpm: null },
        sleep: { status: "insufficient", hours: null },
        pem: { flag: false },
      },
      drivers: [],
      tags: ["pacing_general"],
      fallback: {
        energyLevel: "gray",
        pemRisk: "low",
        stabilityScore: null,
        scoreDrivers: [],
        evidenceTags: ["pacing_general"],
        summary: "Not enough data yet — sync your watch and check in to get today's read.",
      },
    };
  }

  const score = clampScore(4.8 - deduction);
  const band = bandFromScore(score);
  if (tags.size === 0) tags.add("energy_envelope");
  tags.add("pacing_general");

  const summary = drivers.length
    ? `It might be worth taking it gentle today — ${drivers.join(", and ")}.`
    : "Your overnight signals look steady today.";

  return {
    hasHealth,
    factors: {
      hrv: { status: hrvStatus, deltaPct: hrvDeltaPct },
      rhr: { status: rhrStatus, deltaBpm: rhrDeltaBpm },
      sleep: { status: sleepStatus, hours: sleepHours },
      pem: { flag: pemFlag },
    },
    drivers,
    tags: [...tags],
    fallback: {
      energyLevel: band.energyLevel,
      pemRisk: band.pemRisk,
      stabilityScore: score,
      scoreDrivers: drivers,
      evidenceTags: [...tags],
      summary,
      topTrigger: drivers[0],
    },
  };
}

function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const ANALYST_SYSTEM = `You are a calm pacing analyst for someone with ME/CFS or Long COVID. The single most important thing you produce is a daily Stability Score that helps them PACE — stay inside their energy envelope and avoid post-exertional malaise (PEM).

You receive: passive wearable data (HRV and resting heart rate with personal baselines, sleep, steps), recent voice check-in symptoms/activities, and a deterministic "pem_signal" (research-tuned flags + a fallback score). Treat pem_signal as your anchor. Symptom severity is 0-5: severity 0 means the daily check-in asked about a tracked symptom and it was NOT present that day — a good sign, not a mild symptom.

Output STRICT JSON only, no prose:
{"stabilityScore": <number 1.0-5.0>, "scoreDrivers": ["2-4 short plain-language phrases — see rules below"], "evidenceTags": ["subset of the allowed tags"], "summary": "2-3 warm, plain sentences spoken to 'you'", "topTrigger": "short phrase or null", "recommendation": "one gentle, non-prescriptive suggestion or null"}

Scoring (Visible-style, higher = more stable):
- Anchor to pem_signal. Roughly: 0 flags ≈ 4.5–5.0, one mild flag ≈ 3.0–4.0, one strong or two flags ≈ 1.5–2.5, several ≈ 1.0–1.5.
- You may nudge ±0.5 using symptoms/activities, but do not contradict strong wearable flags.
- scoreDrivers are read by a layperson on the app's home card. Each must be a short everyday-words phrase, grounded in a real figure from the data — but lead with the meaning, not the metric. Write "slept only 4.5 hours" not "sleep 4.5h"; "heart recovery (HRV) 18% below your usual" not "HRV 18% below baseline"; "you reported a crash yesterday" not "PEM flag". Never bare abbreviations, never invented numbers.

evidenceTags — choose ONLY from: hrv_pacing, rhr_strain, sleep_quality, energy_envelope, pem_avoidance, pacing_general. Pick the principles your read leans on. Always include pacing_general. NEVER write study names or URLs.

Tone (evidence-based, NICE 2021 / CDC / Bateman Horne):
- Validate; reframe rest as healing, not weakness. A lower score is information, not failure.
- NEVER give medical advice, name treatments/medications, or say "exercise"/"push through"/"work out". Never alarm.`;

async function callAnalyst(
  apiKey: string,
  payload: unknown,
  signal: Signal
): Promise<AnalystResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5.5",
      // High reasoning: this runs in the background after the check-in, so
      // latency is irrelevant and we want the most careful pacing read.
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: ANALYST_SYSTEM },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no analyst content");
  const parsed = JSON.parse(content) as Record<string, unknown>;

  const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

  // The score is the LLM's call; the band is derived from it so the number and
  // the colour can never disagree.
  let score: number | null = signal.fallback.stabilityScore;
  if (typeof parsed.stabilityScore === "number" && Number.isFinite(parsed.stabilityScore)) {
    score = clampScore(parsed.stabilityScore);
  }
  const band = bandFromScore(score);

  const drivers = Array.isArray(parsed.scoreDrivers)
    ? (parsed.scoreDrivers.filter((d) => typeof d === "string" && d.trim()) as string[]).slice(0, 4)
    : signal.fallback.scoreDrivers;

  const tags = Array.isArray(parsed.evidenceTags)
    ? (parsed.evidenceTags.filter(
        (t): t is EvidenceTag => typeof t === "string" && EVIDENCE_TAG_SET.has(t)
      ) as EvidenceTag[])
    : signal.fallback.evidenceTags;
  const evidenceTags: EvidenceTag[] = tags.includes("pacing_general")
    ? tags
    : [...tags, "pacing_general"];

  return {
    energyLevel: band.energyLevel,
    pemRisk: band.pemRisk,
    stabilityScore: score,
    scoreDrivers: drivers.length ? drivers : signal.fallback.scoreDrivers,
    evidenceTags: evidenceTags.length ? evidenceTags : ["pacing_general"],
    summary: str(parsed.summary) ?? signal.fallback.summary,
    topTrigger: str(parsed.topTrigger),
    recommendation: str(parsed.recommendation),
  };
}

// Shared analysis core — used by the public action, the auto-trigger, and the
// daily cron. Loads context, computes the signal, calls the analyst (or falls
// back), and writes the insight row as "ready".
async function runAnalysisCore(
  ctx: ActionCtx,
  deviceId: string,
  explicitDateKey?: string
): Promise<{ ok: boolean; dateKey: string; energyLevel: EnergyLevel }> {
  const data = await ctx.runQuery(internal.insights.gatherContext, {
    deviceId,
    sinceMs: Date.now() - 8 * DAY_MS,
  });
  const dateKey =
    explicitDateKey ?? data.snapshots[0]?.dateKey ?? utcDateKey(Date.now());
  const today = (data.snapshots.find((s: Snapshot) => s.dateKey === dateKey) ??
    data.snapshots[0] ??
    null) as Snapshot | null;

  const latestSession = data.sessions[0] ?? null;
  const unrefreshingSleep = data.symptoms.some(
    (s) => s.category === "unrefreshing_sleep"
  );
  const signal = computePemSignal(today, {
    hadPEMToday: latestSession?.hadPEMToday === true,
    unrefreshingSleep,
  });

  // No wearable data AND no check-in content → honest "gray", never green.
  const hasCheckin = data.sessions.length > 0 || data.symptoms.length > 0;
  const apiKey = process.env.OPENAI_API_KEY;

  let result: AnalystResult = signal.fallback;
  let model = "heuristic";
  if (apiKey && (signal.hasHealth || hasCheckin)) {
    try {
      const payload = {
        date: dateKey,
        today_health: today,
        recent_health: data.snapshots,
        recent_sessions: data.sessions.map((s: Doc<"sessions">) => ({
          startedAt: s.startedAt,
          energyScore: s.energyScore ?? null,
          sleepHours: s.sleepHours ?? null,
          hadPEMToday: s.hadPEMToday ?? null,
          summary: s.summary ?? null,
        })),
        recent_symptoms: data.symptoms.map((s: Doc<"symptoms">) => ({
          category: s.category,
          userWords: s.userWords,
          severity: s.severity ?? null,
        })),
        recent_activities: data.activities.map((a: Doc<"activities">) => ({
          category: a.category,
          userWords: a.userWords,
          exertion: a.exertion ?? null,
          durationMinutes: a.durationMinutes ?? null,
        })),
        pem_signal: {
          factors: signal.factors,
          drivers: signal.drivers,
          fallback_score: signal.fallback.stabilityScore,
        },
        allowed_evidence_tags: EVIDENCE_TAGS,
      };
      result = await callAnalyst(apiKey, payload, signal);
      model = "gpt-5.5";
    } catch (e) {
      console.error("[insights] analyst LLM failed; using heuristic fallback", e);
      result = signal.fallback;
      model = "heuristic";
    }
  }

  await ctx.runMutation(internal.insights.writeInsight, {
    deviceId,
    dateKey,
    energyLevel: result.energyLevel,
    pemRisk: result.pemRisk,
    stabilityScore: result.stabilityScore,
    scoreDrivers: result.scoreDrivers,
    evidenceTags: result.evidenceTags,
    summary: result.summary,
    topTrigger: result.topTrigger,
    recommendation: result.recommendation,
    model,
    status: "ready",
  });

  return { ok: true, dateKey, energyLevel: result.energyLevel };
}

// ── Public action: the manual "Re-analyze" button ──────────────────────────
export const analyzeToday = action({
  args: { deviceId: v.string(), dateKey: v.optional(v.string()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; dateKey: string; energyLevel: EnergyLevel }> => {
    return await runAnalysisCore(ctx, args.deviceId, args.dateKey);
  },
});

// ── Auto-trigger: scheduled by sessions.finalize when a check-in ends ───────
export const runAnalysis = internalAction({
  args: { deviceId: v.string(), dateKey: v.optional(v.string()) },
  handler: async (
    ctx,
    args
  ): Promise<{ ok: boolean; dateKey: string; energyLevel: EnergyLevel }> => {
    return await runAnalysisCore(ctx, args.deviceId, args.dateKey);
  },
});

// ── Daily cron entrypoint: analyze every recently-active device ────────────
export const dailyAnalyze = internalAction({
  args: {},
  handler: async (ctx) => {
    const deviceIds = await ctx.runQuery(internal.insights.recentDevices, {
      sinceMs: Date.now() - 2 * DAY_MS,
    });
    for (const deviceId of deviceIds) {
      try {
        await ctx.runAction(api.insights.analyzeToday, { deviceId });
      } catch (e) {
        console.error(`[insights] dailyAnalyze failed for ${deviceId}`, e);
      }
    }
  },
});
