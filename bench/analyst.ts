// Benchmark for the pacing analyst (gpt-5.5 in convex/insights.ts).
//
// Calls the REAL production path — callAnalyst(), including the anchor clamp,
// forbidden-output guards, and tag filtering — against synthetic day-payloads
// whose expected outcome band is derived from the same research thresholds the
// deterministic pem_signal uses. Each case runs twice (stability check).
//
// Checks per case: level band, score range, run-to-run spread, driver count &
// numeric grounding (no invented numbers), topTrigger length, forbidden
// phrases, German output for the DE case, clamp firings.
//
// Run (from repo root):
//   set -a; . agent/.env; set +a; npx tsx bench/analyst.ts [caseId ...]
// Report: bench/analyst.latest.md

import { writeFileSync } from "node:fs";

import {
  EVIDENCE_TAGS,
  callAnalyst,
  computePemSignal,
  type AnalystResult,
  type Snapshot,
} from "../convex/insights.js";

const KEY = process.env.OPENAI_API_KEY ?? "";
if (!KEY) {
  console.error(
    "OPENAI_API_KEY not set — run: set -a; . agent/.env; set +a; npx tsx bench/analyst.ts"
  );
  process.exit(1);
}

// ── Case definitions ─────────────────────────────────────────────────────────

type Level = "green" | "yellow" | "red" | "gray";
type BenchCase = {
  id: string;
  locale: "en" | "de";
  snapshot: Snapshot | null;
  extras: { hadPEMToday?: boolean; unrefreshingSleep?: boolean; recentSnapshots?: Snapshot[] };
  session?: { energyScore?: number; sleepHours?: number; hadPEMToday?: boolean; summary?: string };
  symptoms?: { category: string; userWords: string; severity: number | null }[];
  activities?: { category: string; userWords: string; exertion?: number }[];
  priorScores?: number[]; // oldest last, like prod
  expect: {
    levels: Level[]; // acceptable bands
    scoreMin?: number;
    scoreMax?: number;
    german?: boolean;
    // Deterministic: the pem_signal must carry the cumulative_load flag.
    loadFlag?: boolean;
    // The read must actually surface the pattern somewhere user-visible.
    driverPattern?: RegExp;
  };
};

const snap = (p: Partial<Snapshot>): Snapshot => ({
  dateKey: "2026-07-06",
  hrvMs: null,
  hrvBaselineMs: null,
  restingHrBpm: null,
  rhrBaseline7d: null,
  sleepHours: null,
  steps: null,
  ...p,
});

const CASES: BenchCase[] = [
  {
    // Everything at baseline → anchor 4.8. Must be green, no invented worry.
    id: "clean-green",
    locale: "en",
    snapshot: snap({
      hrvMs: 52,
      hrvBaselineMs: 50,
      restingHrBpm: 61,
      rhrBaseline7d: 62,
      sleepHours: 7.6,
      steps: 3200,
    }),
    extras: {},
    session: {
      energyScore: 4,
      sleepHours: 7.6,
      hadPEMToday: false,
      summary: "You slept well and feel steady.",
    },
    symptoms: [],
    expect: { levels: ["green"], scoreMin: 4.0 },
  },
  {
    // HRV -17% (mild flag, anchor 4.0) + mild fatigue → high yellow / low green.
    id: "mild-hrv-dip",
    locale: "en",
    snapshot: snap({
      hrvMs: 41.5,
      hrvBaselineMs: 50,
      restingHrBpm: 62,
      rhrBaseline7d: 62,
      sleepHours: 7.1,
    }),
    extras: {},
    session: { energyScore: 3, hadPEMToday: false },
    symptoms: [{ category: "fatigue", userWords: "a bit heavier than usual", severity: 2 }],
    expect: { levels: ["yellow", "green"], scoreMin: 2.5, scoreMax: 4.5 },
  },
  {
    // Crash + HRV -25% + 5.5h unrefreshing sleep → anchor 1.0. Hard red.
    id: "crash-day-red",
    locale: "en",
    snapshot: snap({
      hrvMs: 37.5,
      hrvBaselineMs: 50,
      restingHrBpm: 66,
      rhrBaseline7d: 62,
      sleepHours: 5.5,
    }),
    extras: { hadPEMToday: true, unrefreshingSleep: true },
    session: { energyScore: 1, sleepHours: 5.5, hadPEMToday: true },
    symptoms: [
      { category: "pem", userWords: "yesterday caught up with me", severity: 4 },
      { category: "unrefreshing_sleep", userWords: "not restful at all", severity: 3 },
    ],
    activities: [{ category: "household", userWords: "cleaned the kitchen", exertion: 4 }],
    expect: { levels: ["red"], scoreMax: 2.0 },
  },
  {
    // RHR +10bpm only (strong flag, anchor 3.2) → yellow.
    id: "rhr-strong",
    locale: "en",
    snapshot: snap({
      hrvMs: 49,
      hrvBaselineMs: 50,
      restingHrBpm: 72,
      rhrBaseline7d: 62,
      sleepHours: 7.2,
    }),
    extras: {},
    session: { energyScore: 3, hadPEMToday: false },
    expect: { levels: ["yellow"], scoreMin: 2.0, scoreMax: 3.7 },
  },
  {
    // Wearables scream (anchor 1.6) but the patient feels GREAT. Optimism must
    // not outvote flags: score ≤ anchor + 0.5 = 2.1 → red.
    id: "conflict-optimist",
    locale: "en",
    snapshot: snap({
      hrvMs: 39,
      hrvBaselineMs: 50,
      restingHrBpm: 63,
      rhrBaseline7d: 62,
      sleepHours: 4.5,
    }),
    extras: {},
    session: {
      energyScore: 5,
      sleepHours: 4.5,
      hadPEMToday: false,
      summary: "You feel great and full of plans.",
    },
    symptoms: [
      { category: "fatigue", userWords: "honestly fine today", severity: 0 },
      { category: "brain_fog", userWords: "clear headed", severity: 0 },
    ],
    expect: { levels: ["red"], scoreMax: 2.1 },
  },
  {
    // Wearables clean (anchor 4.8) but severe subjective day. The analyst may
    // freely go LOWER — a 4.5+ here would be tone-deaf.
    id: "conflict-pessimist",
    locale: "en",
    snapshot: snap({
      hrvMs: 51,
      hrvBaselineMs: 50,
      restingHrBpm: 61,
      rhrBaseline7d: 62,
      sleepHours: 7.4,
    }),
    extras: {},
    session: { energyScore: 1, hadPEMToday: false },
    symptoms: [
      { category: "fatigue", userWords: "completely drained", severity: 5 },
      { category: "pain", userWords: "aching all over", severity: 4 },
      { category: "brain_fog", userWords: "can barely think", severity: 4 },
    ],
    expect: { levels: ["yellow", "red"], scoreMax: 3.5 },
  },
  {
    // Severity 0 across the panel = a CLEAR day, not mild symptoms. Green.
    id: "severity-zero-day",
    locale: "en",
    snapshot: snap({
      hrvMs: 53,
      hrvBaselineMs: 50,
      restingHrBpm: 60,
      rhrBaseline7d: 62,
      sleepHours: 7.9,
    }),
    extras: {},
    session: { energyScore: 4, hadPEMToday: false },
    symptoms: [
      { category: "fatigue", userWords: "not today", severity: 0 },
      { category: "brain_fog", userWords: "clear", severity: 0 },
      { category: "pain", userWords: "none", severity: 0 },
    ],
    expect: { levels: ["green"], scoreMin: 4.0 },
  },
  {
    // No wearables at all, thin check-in ("felt tired"). Anchor is null (no
    // clamp) — the analyst must not confidently paint green from nothing.
    id: "sparse-no-wearables",
    locale: "en",
    snapshot: null,
    extras: {},
    session: { summary: "You said you felt tired today.", energyScore: 2 },
    symptoms: [{ category: "fatigue", userWords: "pretty tired", severity: 3 }],
    expect: { levels: ["yellow", "red", "gray"], scoreMax: 3.9 },
  },
  {
    // Two consecutive above-median step days (cumulative_load, C5) with
    // otherwise clean overnight wearables → one mild flag, anchor 4.0. The
    // deterministic flag must fire and the read must surface the pattern.
    id: "cumulative-load",
    locale: "en",
    snapshot: snap({
      hrvMs: 51,
      hrvBaselineMs: 50,
      restingHrBpm: 61,
      rhrBaseline7d: 62,
      sleepHours: 7.3,
      steps: 2100,
    }),
    extras: {
      recentSnapshots: [
        snap({
          hrvMs: 51,
          hrvBaselineMs: 50,
          restingHrBpm: 61,
          rhrBaseline7d: 62,
          sleepHours: 7.3,
          steps: 2100,
        }),
        snap({ dateKey: "2026-07-05", steps: 5200 }),
        snap({ dateKey: "2026-07-04", steps: 4900 }),
        snap({ dateKey: "2026-07-03", steps: 3100 }),
        snap({ dateKey: "2026-07-02", steps: 2800 }),
        snap({ dateKey: "2026-07-01", steps: 3300 }),
        snap({ dateKey: "2026-06-30", steps: 2600 }),
        snap({ dateKey: "2026-06-29", steps: 3000 }),
      ],
    },
    session: { energyScore: 3, hadPEMToday: false },
    expect: {
      levels: ["yellow", "green"],
      scoreMin: 3.0,
      scoreMax: 4.5,
      loadFlag: true,
      driverPattern: /activ|busier|busy|steps|two\b.*\bdays/i,
    },
  },
  {
    // German locale on a crash day — output language + tone.
    id: "crash-day-de",
    locale: "de",
    snapshot: snap({
      hrvMs: 38,
      hrvBaselineMs: 50,
      restingHrBpm: 67,
      rhrBaseline7d: 61,
      sleepHours: 5.2,
    }),
    extras: { hadPEMToday: true, unrefreshingSleep: true },
    session: { energyScore: 2, sleepHours: 5.2, hadPEMToday: true },
    symptoms: [
      { category: "pem", userWords: "das Putzen gestern hat mich eingeholt", severity: 4 },
    ],
    activities: [{ category: "household", userWords: "Küche geputzt", exertion: 4 }],
    priorScores: [3.4, 2.8, 2.2],
    expect: { levels: ["red"], scoreMax: 2.0, german: true },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

function buildPayload(c: BenchCase) {
  // Mirrors runAnalysisCore's payload shape.
  const signal = computePemSignal(c.snapshot, c.extras);
  const payload = {
    date: "2026-07-06",
    today_health: c.snapshot,
    recent_health: c.extras.recentSnapshots ?? (c.snapshot ? [c.snapshot] : []),
    prior_insights: (c.priorScores ?? []).map((s, i) => ({
      dateKey: `2026-07-0${3 + i}`,
      stabilityScore: s,
      energyLevel: s >= 4 ? "green" : s >= 2.5 ? "yellow" : "red",
    })),
    recent_sessions: c.session
      ? [
          {
            startedAt: Date.parse("2026-07-06T07:30:00Z"),
            energyScore: c.session.energyScore ?? null,
            sleepHours: c.session.sleepHours ?? null,
            hadPEMToday: c.session.hadPEMToday ?? null,
            summary: c.session.summary ?? null,
          },
        ]
      : [],
    recent_symptoms: c.symptoms ?? [],
    recent_activities: c.activities ?? [],
    pem_signal: {
      factors: signal.factors,
      drivers: signal.drivers,
      fallback_score: signal.fallback.stabilityScore,
    },
    allowed_evidence_tags: EVIDENCE_TAGS,
  };
  return { payload, signal };
}

const FORBIDDEN =
  /\b(exercise|work[- ]?out|training|push through|medication|medikament\w*|supplement\w*|dosage|dosis|sport)\b/i;

function numbersIn(text: string): number[] {
  // "2 out of 5" / "2 von 5" / "2/5": the denominator is the scale, not an
  // invented figure.
  const cleaned = text
    .replace(/(out of|von|auf|\/)\s*5\b/gi, "")
    // Thousands separators ("3,200 steps" / de "3.200") are not decimals.
    .replace(/(\d)[.,](?=\d{3}\b)/g, "$1");
  return (cleaned.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => parseFloat(n.replace(",", ".")));
}

function checkRun(c: BenchCase, r: AnalystResult, payloadJson: string): string[] {
  const v: string[] = [];
  if (!c.expect.levels.includes(r.energyLevel))
    v.push(`level=${r.energyLevel}, want one of [${c.expect.levels}] (score ${r.stabilityScore})`);
  if (c.expect.scoreMin != null && r.stabilityScore != null && r.stabilityScore < c.expect.scoreMin)
    v.push(`score ${r.stabilityScore} < min ${c.expect.scoreMin}`);
  if (c.expect.scoreMax != null && r.stabilityScore != null && r.stabilityScore > c.expect.scoreMax)
    v.push(`score ${r.stabilityScore} > max ${c.expect.scoreMax}`);

  if (r.scoreDrivers.length < 1 || r.scoreDrivers.length > 4)
    v.push(`drivers count ${r.scoreDrivers.length} (want 1-4)`);
  // Numeric grounding: every number a driver mentions must exist in the
  // payload (integer-rounded matches count — the prompt itself rounds).
  const payloadNums = new Set(numbersIn(payloadJson).flatMap((n) => [n, Math.round(n)]));
  for (const d of r.scoreDrivers)
    for (const n of numbersIn(d))
      if (!payloadNums.has(n) && !payloadNums.has(Math.round(n)))
        v.push(`driver invents number ${n}: "${d}"`);

  if (r.topTrigger && r.topTrigger.split(/\s+/).length > 8)
    v.push(`topTrigger too long: "${r.topTrigger}"`);
  for (const [field, text] of Object.entries({
    summary: r.summary,
    recommendation: r.recommendation ?? "",
    topTrigger: r.topTrigger ?? "",
    drivers: r.scoreDrivers.join(" | "),
  }))
    if (FORBIDDEN.test(text)) v.push(`forbidden phrase in ${field}: "${text}"`);

  if (c.expect.driverPattern) {
    const visible = [...r.scoreDrivers, r.summary, r.recommendation ?? "", r.topTrigger ?? ""].join(
      " "
    );
    if (!c.expect.driverPattern.test(visible))
      v.push(`pattern ${c.expect.driverPattern} not surfaced anywhere user-visible`);
  }

  if (!r.evidenceTags.includes("pacing_general")) v.push("missing pacing_general tag");
  if (c.expect.german && !/\b(du|dein\w*|heute|dich|nicht)\b/i.test(r.summary))
    v.push(`summary not German: "${r.summary}"`);
  return v;
}

const only = process.argv.slice(2);
const toRun = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
const RUNS = 2;

type CaseResult = {
  c: BenchCase;
  runs: { r: AnalystResult; ms: number }[];
  violations: string[];
  clamped: number;
};

// Count clamp firings via the console.warn the production code emits.
let clampCount = 0;
const origWarn = console.warn;

async function main() {
  console.warn = (...args: unknown[]) => {
    if (String(args[0]).includes("clamped optimistic score")) clampCount += 1;
    else origWarn(...args);
  };

  const results: CaseResult[] = await Promise.all(
    toRun.map(async (c) => {
      const { payload, signal } = buildPayload(c);
      const payloadJson = JSON.stringify(payload);
      const before = clampCount;
      const runs: { r: AnalystResult; ms: number }[] = [];
      for (let i = 0; i < RUNS; i++) {
        const t0 = Date.now();
        const r = await callAnalyst(KEY, payload, signal, c.locale);
        runs.push({ r, ms: Date.now() - t0 });
      }
      const violations = runs.flatMap(({ r }, i) =>
        checkRun(c, r, payloadJson).map((x) => `run${i + 1}: ${x}`)
      );
      // Deterministic, LLM-free: the pem_signal itself must carry the flag.
      if (
        c.expect.loadFlag !== undefined &&
        signal.factors.cumulative_load.flag !== c.expect.loadFlag
      )
        violations.push(
          `pem_signal cumulative_load=${signal.factors.cumulative_load.flag}, want ${c.expect.loadFlag}`
        );
      // Stability: the two runs must not land in different bands, and scores
      // must not drift by more than 1.0.
      const scores = runs.map(({ r }) => r.stabilityScore).filter((s): s is number => s != null);
      const spread = scores.length === 2 ? Math.abs(scores[0] - scores[1]) : 0;
      if (spread > 1.0) violations.push(`unstable: scores ${scores[0]} vs ${scores[1]}`);
      // A small spread straddling a band edge (e.g. 2.3 vs 2.6 across the 2.5
      // red/yellow line) is quantization, not instability — only flag level
      // flips when the scores genuinely diverge.
      const levels = new Set(runs.map(({ r }) => r.energyLevel));
      if (levels.size > 1 && spread > 0.5)
        violations.push(`unstable: levels ${[...levels].join(" vs ")} (spread ${spread})`);
      return { c, runs, violations, clamped: clampCount - before };
    })
  );
  console.warn = origWarn;

  // ── Report ─────────────────────────────────────────────────────────────────

  const md: string[] = [`# Analyst benchmark — ${new Date().toISOString()}\n`];
  for (const { c, runs, violations, clamped } of results) {
    md.push(`## ${c.id} — ${violations.length === 0 ? "PASS" : "ISSUES"}\n`);
    for (const [i, { r, ms }] of runs.entries()) {
      md.push(
        `**run ${i + 1}** (${(ms / 1000).toFixed(1)}s): score=${r.stabilityScore} level=${r.energyLevel} risk=${r.pemRisk}${clamped ? ` clamped×${clamped}` : ""}`
      );
      md.push(`- drivers: ${r.scoreDrivers.map((d) => `"${d}"`).join(", ")}`);
      md.push(`- summary: ${r.summary}`);
      if (r.recommendation) md.push(`- recommendation: ${r.recommendation}`);
      if (r.topTrigger) md.push(`- topTrigger: ${r.topTrigger}`);
      md.push(`- tags: ${r.evidenceTags.join(", ")} · rationale: ${r.rationale ?? "—"}`);
    }
    if (violations.length)
      md.push(`\n### Violations\n${violations.map((x) => `- ${x}`).join("\n")}`);
    md.push("");
  }
  writeFileSync(new URL("./analyst.latest.md", import.meta.url), md.join("\n"));

  console.log("report: bench/analyst.latest.md\n");
  let failed = 0;
  for (const { c, runs, violations } of results) {
    const scores = runs.map(({ r }) => r.stabilityScore).join("/");
    const status = violations.length === 0 ? "PASS" : `${violations.length} issue(s)`;
    console.log(`${c.id.padEnd(22)} score ${scores}  ${status}`);
    for (const v of violations) console.log(`  - ${v}`);
    if (violations.length) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}

main();
