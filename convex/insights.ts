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
  rationale?: string;
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
    // Score history for continuity ("steadier than yesterday", multi-day
    // slides). Skips "analyzing" placeholders.
    const priorInsights = (
      await ctx.db
        .query("insights")
        .withIndex("by_device_date", (q) => q.eq("deviceId", args.deviceId))
        .order("desc")
        .take(8)
    )
      .filter((i) => i.status !== "analyzing")
      .map((i) => ({
        dateKey: i.dateKey,
        stabilityScore: i.stabilityScore ?? null,
        energyLevel: i.energyLevel,
        topTrigger: i.topTrigger ?? null,
      }));
    return { snapshots, sessions, symptoms, activities, priorInsights };
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
    rationale: v.optional(v.string()),
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
    // That intentionally drops any cached TTS audio (the text changed) — delete
    // the orphaned blob so storage doesn't accumulate.
    if (existing?.ttsStorageId) {
      await ctx.storage.delete(existing.ttsStorageId);
    }
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
      rationale: args.rationale,
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
    .withIndex("by_device_date", (q) => q.eq("deviceId", deviceId).eq("dateKey", dateKey))
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

// The curated evidence the analyst grounds its read in — the same six
// principles the app's "science behind this" screen shows (src/lib/evidence.ts
// + src/i18n science entries; keep in sync). The model may only lean on and
// tag these; it never sees or invents other sources.
const EVIDENCE_BRIEF = `# Evidence base — the ONLY principles you may lean on (tag = evidenceTags key)
- hrv_pacing (Workwell Foundation; ME Association 2025 HR-pacing study; Altini/HRV4Training): a morning HRV well below the personal baseline signals nervous-system load; easing off when HRV dips helps avoid pushing into a crash. Mild flag ≥15% below baseline, strong >20%.
- rhr_strain (Workwell; Bateman Horne): resting heart rate several beats above the personal usual is an early strain marker — a "go gentle" cue. Mild +5–8 bpm, strong >8 bpm (absolute bpm, not %).
- sleep_quality (Bateman Horne; NICE NG206): unrefreshing, short, or broken sleep is a core ME/CFS feature and one of the strongest day-to-day capacity predictors; a short night lowers the day's envelope. Mild <6h, strong <5h; unrefreshing escalates a mild flag.
- energy_envelope (AMMES; Bateman Horne): stay within the sustainable limit — often ~half of what one feels capable of, resting before exhaustion — to keep a stable baseline.
- pem_avoidance (CDC; Workwell): PEM is a delayed crash 12–48h after overexertion, lasting days; pacing stays below the trigger threshold rather than pushing through and paying later.
- pacing_general (NICE NG206 2021; Patient-Led Research Collaborative): clinical guidance recommends pacing and energy management, never pushing through; rest is part of recovery, not failure.`;

function analystSystem(locale: string): string {
  const language = locale === "de" ? "German (informal du-form)" : "English";
  return `# Role
You are a calm pacing analyst for someone with ME/CFS or Long COVID. You produce their daily Stability Score and read, helping them PACE — stay inside their energy envelope and avoid post-exertional malaise (PEM).

# Input contract
You receive JSON: passive wearable data (HRV and resting heart rate with personal baselines, sleep, steps), recent voice check-in symptoms/activities, prior_insights (recent daily scores, oldest last), and a deterministic "pem_signal" (research-tuned flags + a fallback score computed from the thresholds in the evidence base below). Symptom severity is 0-5: severity 0 means the daily check-in asked about a tracked symptom and it was NOT present that day — a good sign, not a mild symptom.

${EVIDENCE_BRIEF}

# Scoring rules (Visible-style, higher = more stable)
- Anchor to pem_signal. Roughly: 0 flags ≈ 4.5–5.0, one mild flag ≈ 3.0–4.0, one strong or two flags ≈ 1.5–2.5, several ≈ 1.0–1.5.
- You may nudge from the anchor using symptoms/activities. You may always score LOWER than the anchor when check-in evidence justifies it (conservative is safe), but never more than 0.5 ABOVE it — wearable flags are never outvoted by optimism. (Enforced in code; contradictions are clamped.)
- Use prior_insights for continuity: name a trend when real ("third day in a row below 3"), never invent one.
- scoreDrivers are read by a layperson on the app's home card: 2-4 short everyday-words phrases, each grounded in a real figure from the data — lead with the meaning, not the metric. "slept only 4.5 hours", not "sleep 4.5h"; "heart recovery (HRV) 18% below your usual", not "HRV 18% below baseline". Never bare abbreviations, never invented numbers. If a value is not in the data, do not mention it.

# Evidence tags
evidenceTags: pick ONLY the tags above whose principle your read actually leans on. Always include pacing_general. NEVER write study names or URLs in any text field.

# Language & tone (NICE 2021 / CDC / Bateman Horne aligned)
- Write summary, recommendation, topTrigger, and scoreDrivers in ${language}.
- Speak to "you", warm and plain. Validate; reframe rest as healing, not weakness. A lower score is information, not failure.
- NEVER give medical advice, name treatments/medications/supplements, or say "exercise"/"push through"/"work out". Never alarm.

# Output
Fill every field of the response schema. rationale: ONE short English sentence for the engineering log — why this score (e.g. "two strong flags, symptoms confirm; anchored at 1.9"). It is never shown to the user.`;
}

// Strict output contract — schema-enforced by the API, so the prose prompt no
// longer describes JSON shape (per OpenAI reasoning-model guidance).
const ANALYST_RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "pacing_read",
    strict: true,
    schema: {
      type: "object",
      properties: {
        stabilityScore: { type: "number", minimum: 1, maximum: 5 },
        scoreDrivers: { type: "array", items: { type: "string" }, maxItems: 4 },
        evidenceTags: { type: "array", items: { type: "string", enum: [...EVIDENCE_TAGS] } },
        summary: { type: "string" },
        topTrigger: { type: ["string", "null"] },
        recommendation: { type: ["string", "null"] },
        rationale: { type: "string" },
      },
      required: [
        "stabilityScore",
        "scoreDrivers",
        "evidenceTags",
        "summary",
        "topTrigger",
        "recommendation",
        "rationale",
      ],
      additionalProperties: false,
    },
  },
} as const;

// Deterministic zero-tolerance guardrail: the prompt forbids advice/treatment
// talk, but forbidding in code is what makes it a guarantee. A hit drops the
// offending field back to the deterministic fallback (never the whole read).
const FORBIDDEN_OUTPUT =
  /\b(exercise|work[- ]?out|training|push through|medication|medikament\w*|supplement\w*|nahrungsergänzung\w*|dosage|dosis|sport)\b/i;

function guardText(field: string, text: string | undefined): string | undefined {
  if (text && FORBIDDEN_OUTPUT.test(text)) {
    console.warn(`[insights] guardrail: dropped ${field}: "${text}"`);
    return undefined;
  }
  return text;
}

async function callAnalyst(
  apiKey: string,
  payload: unknown,
  signal: Signal,
  locale: string
): Promise<AnalystResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5.5",
      // High reasoning: this runs in the background after the check-in, so
      // latency is irrelevant and we want the most careful pacing read.
      reasoning_effort: "high",
      response_format: ANALYST_RESPONSE_SCHEMA,
      messages: [
        { role: "system", content: analystSystem(locale) },
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
    // Enforce the anchor rule in code, not prompt-hope: with real wearable
    // data the model may go LOWER than the deterministic anchor (conservative
    // is safe) but never more than 0.5 above it — optimism can't outvote flags.
    const anchor = signal.fallback.stabilityScore;
    if (signal.hasHealth && anchor != null && score > anchor + 0.5) {
      console.warn(`[insights] clamped optimistic score ${score} to anchor ${anchor}+0.5`);
      score = clampScore(anchor + 0.5);
    }
  }
  const band = bandFromScore(score);

  const rawDrivers = Array.isArray(parsed.scoreDrivers)
    ? (parsed.scoreDrivers.filter((d) => typeof d === "string" && d.trim()) as string[]).slice(0, 4)
    : signal.fallback.scoreDrivers;
  const drivers = rawDrivers.filter((d) => guardText("scoreDriver", d) !== undefined);

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
    summary: guardText("summary", str(parsed.summary)) ?? signal.fallback.summary,
    topTrigger: guardText("topTrigger", str(parsed.topTrigger)),
    recommendation: guardText("recommendation", str(parsed.recommendation)),
    rationale: str(parsed.rationale),
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
  const dateKey = explicitDateKey ?? data.snapshots[0]?.dateKey ?? utcDateKey(Date.now());
  const today = (data.snapshots.find((s: Snapshot) => s.dateKey === dateKey) ??
    data.snapshots[0] ??
    null) as Snapshot | null;

  const latestSession = data.sessions[0] ?? null;
  const unrefreshingSleep = data.symptoms.some((s) => s.category === "unrefreshing_sleep");
  const signal = computePemSignal(today, {
    hadPEMToday: latestSession?.hadPEMToday === true,
    unrefreshingSleep,
  });

  // No wearable data AND no check-in content → honest "gray", never green.
  const hasCheckin = data.sessions.length > 0 || data.symptoms.length > 0;
  const apiKey = process.env.OPENAI_API_KEY;
  // The user's language, from their most recent session (set at mint time).
  const locale = data.sessions.find((s) => s.locale)?.locale ?? "en";

  let result: AnalystResult = signal.fallback;
  let model = "heuristic";
  if (apiKey && (signal.hasHealth || hasCheckin)) {
    try {
      const payload = {
        date: dateKey,
        today_health: today,
        recent_health: data.snapshots,
        prior_insights: data.priorInsights,
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
      result = await callAnalyst(apiKey, payload, signal, locale);
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
    rationale: result.rationale,
    model,
    status: "ready",
  });

  return { ok: true, dateKey, energyLevel: result.energyLevel };
}

// ── Voice playback: OpenAI TTS of recommendation + summary ─────────────────

export const saveInsightAudio = internalMutation({
  args: { insightId: v.id("insights"), storageId: v.id("_storage"), text: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.insightId);
    if (!existing) {
      // Insight was replaced while we were generating — drop the new blob too.
      await ctx.storage.delete(args.storageId);
      return;
    }
    if (existing.ttsStorageId) await ctx.storage.delete(existing.ttsStorageId);
    await ctx.db.patch(args.insightId, { ttsStorageId: args.storageId, ttsText: args.text });
  },
});

// Returns a playable URL for the latest insight, generating and caching the
// audio on first request. Voice matches the check-in agent's default variant.
export const speakInsight = action({
  args: { deviceId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    const insight: Doc<"insights"> | null = await ctx.runQuery(api.insights.latestInsight, {
      deviceId: args.deviceId,
    });
    if (!insight) return null;
    const text = [insight.recommendation, insight.summary].filter(Boolean).join(" ");
    if (!text) return null;

    if (insight.ttsStorageId && insight.ttsText === text) {
      const cached = await ctx.storage.getUrl(insight.ttsStorageId);
      if (cached) return cached;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "marin", // agent/src/variants.ts DEFAULT_VARIANT — same companion voice
        input: text,
        instructions:
          "Speak slowly, calmly and warmly — a gentle companion for someone with chronic fatigue. Never rushed, never alarmed.",
        response_format: "mp3",
      }),
    });
    if (!res.ok) throw new Error(`openai tts ${res.status}: ${await res.text()}`);

    const storageId = await ctx.storage.store(await res.blob());
    await ctx.runMutation(internal.insights.saveInsightAudio, {
      insightId: insight._id,
      storageId,
      text,
    });
    return await ctx.storage.getUrl(storageId);
  },
});

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
