// Tool handlers — each POSTs to the Convex /agent-event HTTP endpoint.

import type { ActivityCategory, SymptomCategory } from "./taxonomy.js";

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
      // 4xx = our fault, no point retrying. break (don't throw inside the
      // try — our own catch below would swallow it and retry anyway).
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => "");
        lastError = new Error(`agent-event ${res.status}: ${text}`);
        break;
      }
      // 5xx = retry
      lastError = new Error(`agent-event ${res.status}`);
    } catch (err) {
      // Network errors → retry.
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("agent-event failed");
}

export async function appendTranscript(
  sessionId: string,
  role: "user" | "assistant",
  text: string
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
  }
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
  }
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
  }
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
  }
) {
  await postEvent({ type: "correct_last_activity", sessionId, ...args });
}

export async function recordSessionContext(
  sessionId: string,
  args: {
    sleepHours?: number;
    hadPEMToday?: boolean;
  }
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
  }
) {
  await postEvent({ type: "finalize", sessionId, ...args });
}

// HealthKit snapshot — comes from the client via LiveKit participant metadata.
// Null fields mean "couldn't read" (no Apple Watch, denied permission,
// simulator, Android). See HEALTHKIT.md for the full mapping.
//
// The raw biomarkers (HRV, resting HR) are NOT surfaced to the voice agent:
// they belong to the Stage-2 analyst (which has the rolling baselines to
// interpret them), and the product decision is that the check-in stays
// "mostly silent" on numbers. The agent only needs the fields that change
// what it ASKS — sleep duration (so it can skip the "how long" question) and
// yesterday's load — via summarizeHealthForPrompt() below.

export type HealthSnapshot = {
  hrvMs: number | null;
  hrvBaselineMs: number | null;
  restingHrBpm: number | null;
  // 7-day resting-HR baseline (server-computed). Optional: only supplied when
  // the client has it (e.g. demo mode reads the stored Convex snapshot).
  rhrBaseline7d?: number | null;
  sleepHoursLastNight: number | null;
  // Steps so far today (live) — Today-screen chip only, not used by the agent.
  stepsToday: number | null;
  // Yesterday's complete step count — light context for "what did you do".
  stepsYesterday: number | null;
};

/**
 * Builds a short, natural-language briefing injected into the system prompt so
 * the questionnaire can ADAPT from the first turn — e.g. skip "how long did you
 * sleep?" when the watch already knows. Research-aligned (ecological momentary
 * assessment: let passive sensor data replace prompts, ask only what the sensor
 * can't see). Returns "" when nothing is known, so the prompt stays unchanged.
 *
 * Deliberately omits HRV/resting-HR: those are the analyst's job and the agent
 * is meant to stay silent on raw numbers. Only sleep + activity load shape the
 * conversation, so only those appear here.
 */
export function summarizeHealthForPrompt(
  snapshot: HealthSnapshot | null | undefined,
  locale: string | null | undefined
): string {
  if (!snapshot) return "";
  const de = locale === "de";
  const lines: string[] = [];

  if (snapshot.sleepHoursLastNight != null) {
    const h = Math.round(snapshot.sleepHoursLastNight * 10) / 10;
    // On a clearly short night (<6h, the analyst's mild-flag threshold) the
    // agent may gently NAME what the watch saw — still no numbers. This is the
    // "it noticed" moment that makes passive capture feel real; on normal
    // nights the data stays silent as before.
    const short = h < 6;
    lines.push(
      de
        ? short
          ? `- Schlaf letzte Nacht: ca. ${h} h — eine kurze Nacht. Du darfst das einmal sanft ansprechen („sieht nach einer kurzen Nacht aus"), ohne die Zahl zu nennen. Frag NICHT, wie lange — nur, ob es erholsam war.`
          : `- Schlaf letzte Nacht: ca. ${h} h. Frag NICHT, wie lange sie geschlafen haben — frag nur, ob es erholsam war.`
        : short
          ? `- Sleep last night: about ${h}h — a short night. You may gently acknowledge it once ("looks like a short night") without saying the number. Do NOT ask how long — only whether it felt restful.`
          : `- Sleep last night: about ${h}h. Do NOT ask how long they slept — ask only whether it felt restful.`
    );
  }
  if (snapshot.stepsYesterday != null) {
    lines.push(
      de
        ? `- Schritte gestern: ca. ${Math.round(snapshot.stepsYesterday)}. Nur Kontext dazu, wie viel sie gestern gemacht haben — frag trotzdem, wie es sich angefühlt hat.`
        : `- Steps yesterday: about ${Math.round(snapshot.stepsYesterday)}. Context for how much they did — still ask how it FELT.`
    );
  }

  // Overnight biomarkers — only when meaningfully off baseline (the analyst's
  // own mild-flag thresholds: HRV ≥15% below, resting HR ≥5 bpm above). The
  // agent may NAME the signal once, gently and qualitatively ("your HRV looked
  // quite low overnight") — never the figures, never an interpretation. Within
  // range, the numbers stay out of the prompt entirely: the agent has nothing
  // to slip on.
  const hrvDelta =
    snapshot.hrvMs != null && snapshot.hrvBaselineMs != null && snapshot.hrvBaselineMs > 0
      ? (snapshot.hrvBaselineMs - snapshot.hrvMs) / snapshot.hrvBaselineMs
      : null;
  if (hrvDelta != null && hrvDelta >= 0.15) {
    lines.push(
      de
        ? `- HRV über Nacht: deutlich unter ihrer üblichen Baseline. Du darfst das einmal sanft erwähnen („deine HRV sah heute Nacht ziemlich niedrig aus" / „deine Erholungswerte wirken heute etwas niedrig") — qualitativ, ohne Zahlen, ohne Deutung, nie alarmiert.`
        : `- Overnight HRV: well below their usual baseline. You may mention it once, gently ("your HRV looked quite low overnight" / "your recovery signals look a bit low today") — qualitative, no figures, no interpretation, never alarmed.`
    );
  }
  const rhrDelta =
    snapshot.restingHrBpm != null && snapshot.rhrBaseline7d != null
      ? snapshot.restingHrBpm - snapshot.rhrBaseline7d
      : null;
  if (rhrDelta != null && rhrDelta >= 5) {
    lines.push(
      de
        ? `- Ruhepuls: merklich über ihrem üblichen Wert. Darfst du einmal sanft erwähnen („dein Ruhepuls war heute Nacht etwas erhöht") — qualitativ, ohne Zahlen, nie alarmiert.`
        : `- Resting heart rate: noticeably above their usual. You may mention it once, gently ("your resting heart rate ran a little high overnight") — qualitative, no figures, never alarmed.`
    );
  }

  if (lines.length === 0) return "";

  const header = de
    ? "# Was du heute Morgen schon weißt\nMit Bedacht nutzen — nie exakte Zahlen vorlesen, nie alarmiert klingen, nichts deuten. Erwähne höchstens EIN Signal pro Gespräch, dort wo es natürlich passt; alles andere bleibt still:"
    : "# What you already know this morning\nUse with care — never recite exact figures, never sound alarmed, never interpret. Mention at most ONE signal per conversation, where it fits naturally; everything else stays silent:";
  return `${header}\n${lines.join("\n")}`;
}

// Spoken names for the daily symptom panel — what the agent actually says
// when asking a tracked symptom by name. Keys mirror taxonomy.ts.
const PANEL_SPOKEN_NAMES: Record<string, { en: string; de: string }> = {
  fatigue: { en: "the fatigue", de: "die Erschöpfung" },
  brain_fog: { en: "the brain fog", de: "der Brain-Fog" },
  pain: { en: "the pain", de: "die Schmerzen" },
  orthostatic: {
    en: "the dizziness or racing heart when upright",
    de: "der Schwindel oder das Herzrasen im Stehen",
  },
  flu_feeling: { en: "the flu-like feeling", de: "das Grippegefühl" },
};

/**
 * Builds the "tracked symptoms — ask these daily" briefing for the system
 * prompt. The panel is the user's recurring symptoms (computed server-side in
 * mintToken from the last 14 days), asked by name every morning so symptom
 * data becomes a dense daily series (Visible-style fixed panel) instead of
 * volunteer-only sparse mentions. Severity 0 = asked & not present today.
 * Returns "" when the panel is empty (e.g. a brand-new user).
 */
export function summarizeSymptomPanelForPrompt(
  panel: string[] | null | undefined,
  locale: string | null | undefined
): string {
  if (!panel || panel.length === 0) return "";
  const de = locale === "de";
  const lines = panel
    .filter((c) => PANEL_SPOKEN_NAMES[c])
    .map((c) => {
      const name = de ? PANEL_SPOKEN_NAMES[c].de : PANEL_SPOKEN_NAMES[c].en;
      return de
        ? `- ${name} (record_symptom Kategorie ${c})`
        : `- ${name} (record_symptom category ${c})`;
    });
  if (lines.length === 0) return "";

  const header = de
    ? `# Ihre verfolgten Symptome (täglich abfragen)
In Kästchen ③, vor der offenen Frage, frag jedes mit Namen ab, eins pro Runde — z. B. „Wie ist der Brain-Fog heute — eins bis fünf?":`
    : `# Their tracked symptoms (ask these daily)
In box ③, before the open question, ask each by name, one per turn — e.g. "How's the brain fog today — one to five?":`;
  const footer = de
    ? "Ist eins heute nicht da, nimm es mit Schwere 0 auf — ein klarer Tag ist genauso wertvoll."
    : "If one isn't there today, record it with severity 0 — a clear day is just as valuable.";
  return `${header}\n${lines.join("\n")}\n${footer}`;
}
