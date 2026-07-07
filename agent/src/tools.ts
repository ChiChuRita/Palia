// Tool handlers — each POSTs to the Convex /agent-event HTTP endpoint.

import {
  ACTIVITY_CATEGORY_KEYS,
  SYMPTOM_CATEGORY_KEYS,
  type ActivityCategory,
  type SymptomCategory,
} from "./taxonomy.js";

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

// ── Transcript analysis (one offline pass, replaces in-call record tools) ────
//
// Realtime voice models narrate tool calls ("one moment, noting that down") no
// matter the prompt, so the boxes carry no record tools at all. Instead this
// single gpt-5.5 pass reads the full transcript once the call ends and extracts
// everything structured — symptoms, activities, sleep, PEM, energy, summary.
// Latency-irrelevant (the call is over); a templated fallback keeps finalize
// alive if the model errors.

export type Analysis = {
  summary: string;
  energyScore: number;
  flags?: string[];
  symptoms: {
    category: SymptomCategory;
    userWords: string;
    severity?: number;
    note?: string;
  }[];
  activities: {
    category: ActivityCategory;
    userWords: string;
    exertion?: number;
    durationMinutes?: number;
  }[];
  sleepHours?: number;
  hadPEMToday?: boolean;
};

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    energy_score: { type: "integer", minimum: 1, maximum: 5 },
    flags: { type: "array", items: { type: "string" } },
    symptoms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: SYMPTOM_CATEGORY_KEYS },
          userWords: { type: "string" },
          // Range (0-5) is stated in the prompt, not the schema: strict mode is
          // finicky about numeric bounds on nullable fields, and a schema
          // rejection here would silently drop every record via the fallback.
          severity: { type: ["integer", "null"] },
          note: { type: ["string", "null"] },
        },
        required: ["category", "userWords", "severity", "note"],
        additionalProperties: false,
      },
    },
    activities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: ACTIVITY_CATEGORY_KEYS },
          userWords: { type: "string" },
          exertion: { type: ["integer", "null"] },
          durationMinutes: { type: ["integer", "null"] },
        },
        required: ["category", "userWords", "exertion", "durationMinutes"],
        additionalProperties: false,
      },
    },
    sleep_hours: { type: ["number", "null"] },
    had_pem_today: { type: ["boolean", "null"] },
  },
  required: [
    "summary",
    "energy_score",
    "flags",
    "symptoms",
    "activities",
    "sleep_hours",
    "had_pem_today",
  ],
  additionalProperties: false,
} as const;

export async function analyzeTranscript(transcript: string, locale: string): Promise<Analysis> {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const de = locale === "de";

  const delays = [0, 250, 1000];
  let lastError: unknown = null;
  for (const delay of delays) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-5.5",
          reasoning_effort: "low",
          response_format: {
            type: "json_schema",
            json_schema: { name: "checkin_analysis", strict: true, schema: ANALYSIS_SCHEMA },
          },
          messages: [
            {
              role: "system",
              content: `You extract structured records from the transcript of a daily voice check-in with an ME/CFS / Long COVID patient. Only record what the patient actually said — never invent. Resolve corrections to the FINAL value — including corrections made much later in the conversation ("sorry, about the pain — it's more a three") and mid-sentence revisions ("a four... actually more like a three" = 3). The latest statement about a thing always wins.
PATIENT lines come from speech-to-text and may contain recognition errors — read them phonetically and in context (German "Komm' bock mehr?" ≈ "kein Bock mehr"; the agent's coherent reply often reveals what was actually said). When a patient line is too garbled to interpret confidently, record nothing from it rather than guessing.
- symptoms: one per distinct symptom the patient reported. Map to the closest category. Put the patient's own words in userWords. severity 0-5 (0 = a symptom was asked about and is NOT present today); null if no severity was given. unrefreshing_sleep counts as a symptom when they say sleep wasn't restful. Map shortness of breath / "outer Atem" / can't catch their breath to breathlessness, and low mood / anxiety / feeling down or on edge to mood.
- activities: what they did (usually yesterday). exertion 1-5 as they described how it FELT; null if not given.
- sleep_hours: number if a duration was stated, else null. had_pem_today: true/false if the crash question was answered, else null.
- summary: 1-2 warm, plain ${de ? "German" : "English"} sentences addressed to "you" for the patient's own history view (how they slept, crash status, main symptoms, yesterday's load). No advice, no alarm, no invented detail.
- energy_score: the patient's stated energy 1-5, else your best estimate from the conversation (2 if unclear).
- flags: empty array, or short markers like "cant_talk" if the check-in was cut short.`,
            },
            { role: "user", content: transcript || "(no transcript captured)" },
          ],
        }),
      });
      if (!res.ok) {
        lastError = new Error(`analysis ${res.status}: ${await res.text()}`);
        if (res.status >= 400 && res.status < 500) break;
        continue;
      }
      const json = await res.json();
      const p = JSON.parse(json.choices[0].message.content);
      return {
        summary: p.summary,
        energyScore: p.energy_score,
        flags: p.flags?.length ? p.flags : undefined,
        symptoms: (p.symptoms ?? []).map((s: Record<string, unknown>) => ({
          category: s.category as SymptomCategory,
          userWords: s.userWords as string,
          severity: s.severity == null ? undefined : (s.severity as number),
          note: s.note == null ? undefined : (s.note as string),
        })),
        activities: (p.activities ?? []).map((a: Record<string, unknown>) => ({
          category: a.category as ActivityCategory,
          userWords: a.userWords as string,
          exertion: a.exertion == null ? undefined : (a.exertion as number),
          durationMinutes: a.durationMinutes == null ? undefined : (a.durationMinutes as number),
        })),
        sleepHours: p.sleep_hours == null ? undefined : p.sleep_hours,
        hadPEMToday: p.had_pem_today == null ? undefined : p.had_pem_today,
      };
    } catch (err) {
      lastError = err;
    }
  }

  // Fallback — finalize must always POST something.
  console.error("[mecfs-agent] transcript analysis failed, using fallback", lastError);
  return {
    summary: de ? "Check-in abgeschlossen." : "Check-in completed.",
    energyScore: 2,
    symptoms: [],
    activities: [],
  };
}

// POST every extracted record, then the session context. Called by the runner
// after analysis — these are the events the in-call tools used to send live.
export async function persistRecords(sessionId: string, a: Analysis): Promise<void> {
  for (const s of a.symptoms) await recordSymptom(sessionId, s);
  for (const act of a.activities) await recordActivity(sessionId, act);
  await recordSessionContext(sessionId, { sleepHours: a.sleepHours, hadPEMToday: a.hadPEMToday });
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
  // False = the newest HealthKit sleep sample is NOT from last night (stale
  // data, e.g. the watch wasn't worn). Absent/undefined = trust it as usual.
  sleepIsLastNight?: boolean;
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
  locale: string | null | undefined,
  daypart?: "morning" | "afternoon" | "evening" | null
): string {
  if (!snapshot) return "";
  const de = locale === "de";
  const lines: string[] = [];

  // Explicitly stale sleep data (C1): never assert last night's sleep — the
  // scripted lead would confidently describe a night the watch never saw.
  // Falls back to the no-sleep-data behavior (the agent just asks).
  const sleepFresh = snapshot.sleepIsLastNight !== false;

  // Off-baseline biomarkers first — heavyDay decides whether the sleep-lead
  // gets emitted at all (a "lead the sleep topic" line contradicts the
  // short-form "crash + energy are enough" line in the same briefing).
  const hrvDelta =
    snapshot.hrvMs != null && snapshot.hrvBaselineMs != null && snapshot.hrvBaselineMs > 0
      ? (snapshot.hrvBaselineMs - snapshot.hrvMs) / snapshot.hrvBaselineMs
      : null;
  const rhrDelta =
    snapshot.restingHrBpm != null && snapshot.rhrBaseline7d != null
      ? snapshot.restingHrBpm - snapshot.rhrBaseline7d
      : null;
  // Strongly-bad overnight signals → short form: on a heavy day every extra
  // question costs. Thresholds deliberately above the mention thresholds
  // (HRV >20% vs 15%, RHR +8 vs +5).
  const heavyDay =
    (hrvDelta != null && hrvDelta > 0.2) ||
    (sleepFresh && snapshot.sleepHoursLastNight != null && snapshot.sleepHoursLastNight < 5) ||
    (rhrDelta != null && rhrDelta >= 8);

  if (snapshot.sleepHoursLastNight != null && sleepFresh && !heavyDay) {
    const h = Math.round(snapshot.sleepHoursLastNight * 10) / 10;
    // On a clearly short night (<6h, the analyst's mild-flag threshold) the
    // agent may gently NAME what the watch saw — still no numbers. This is the
    // "it noticed" moment that makes passive capture feel real; on normal
    // nights the data stays silent as before.
    const short = h < 6;
    // The agent LEADS the sleep topic with what the watch saw — the "it
    // noticed" moment that makes passive capture feel real. Duration is what
    // the watch knows; how it FELT is what we ask. Never the exact figure.
    lines.push(
      de
        ? short
          ? `- Schlaf letzte Nacht: ca. ${h} h — eine kurze Nacht. Eröffne das Schlaf-Thema damit, mitfühlend und ohne Zahl: „Ich seh, die Nacht war eher kurz — wie geht's dir damit?" Frag NICHT nach der Dauer.`
          : `- Schlaf letzte Nacht: ca. ${h} h — ordentlich. Eröffne das Schlaf-Thema aktiv damit, ohne Zahl: „Ich seh, du hast anscheinend gut geschlafen — wie war's für dich, erholsam?" Frag NICHT nach der Dauer.`
        : short
          ? `- Sleep last night: about ${h}h — a short night. Open the sleep topic with it, gently and without the number: "I see the night was on the short side — how are you doing with that?" Do NOT ask about duration.`
          : `- Sleep last night: about ${h}h — decent. Open the sleep topic with it, without the number: "I see you seem to have slept well — how did it feel, restful?" Do NOT ask about duration.`
    );
  }
  if (snapshot.stepsYesterday != null) {
    // From afternoon on the activities topic is about TODAY (continuity
    // briefing) — yesterday's steps stay background context, no ask-coaching.
    const morning = daypart == null || daypart === "morning";
    lines.push(
      de
        ? `- Schritte gestern: ca. ${Math.round(snapshot.stepsYesterday)}. Nur Kontext dazu, wie viel sie gestern gemacht haben${morning ? " — frag trotzdem, wie es sich angefühlt hat" : ""}.`
        : `- Steps yesterday: about ${Math.round(snapshot.stepsYesterday)}. Context for how much they did${morning ? " — still ask how it FELT" : ""}.`
    );
  }

  // The mention lines — only when meaningfully off baseline (the analyst's
  // own mild-flag thresholds: HRV ≥15% below, resting HR ≥5 bpm above). The
  // agent may NAME the signal once, gently and qualitatively ("your HRV looked
  // quite low overnight") — never the figures, never an interpretation. Within
  // range, the numbers stay out of the prompt entirely: the agent has nothing
  // to slip on.
  if (hrvDelta != null && hrvDelta >= 0.15) {
    lines.push(
      de
        ? `- HRV über Nacht: deutlich unter ihrer üblichen Baseline. Du darfst das einmal sanft erwähnen („deine HRV sah heute Nacht ziemlich niedrig aus" / „deine Erholungswerte wirken heute etwas niedrig") — qualitativ, ohne Zahlen, ohne Deutung, nie alarmiert.`
        : `- Overnight HRV: well below their usual baseline. You may mention it once, gently ("your HRV looked quite low overnight" / "your recovery signals look a bit low today") — qualitative, no figures, no interpretation, never alarmed.`
    );
  }
  if (rhrDelta != null && rhrDelta >= 5) {
    lines.push(
      de
        ? `- Ruhepuls: merklich über ihrem üblichen Wert. Darfst du einmal sanft erwähnen („dein Ruhepuls war heute Nacht etwas erhöht") — qualitativ, ohne Zahlen, nie alarmiert.`
        : `- Resting heart rate: noticeably above their usual. You may mention it once, gently ("your resting heart rate ran a little high overnight") — qualitative, no figures, never alarmed.`
    );
  }

  if (heavyDay) {
    lines.push(
      de
        ? "- Heute könnte ein schwerer Tag sein: halte den Check-in kurz — Crash und Energie reichen, alles andere nur, wenn sie von selbst erzählt."
        : "- Today could be a heavy day: keep the check-in short — crash and energy are enough, everything else only if they bring it up themselves."
    );
  }

  if (lines.length === 0) return "";

  // Neutral header — "heute Morgen" here primed the exact phrasing the
  // afternoon/evening continuity briefing bans.
  const header = de
    ? "# Was du schon weißt\nMit Bedacht nutzen — nie exakte Zahlen vorlesen, nie alarmiert klingen, nichts deuten. Erwähne höchstens EIN Signal pro Gespräch, dort wo es natürlich passt; alles andere bleibt still:"
    : "# What you already know\nUse with care — never recite exact figures, never sound alarmed, never interpret. Mention at most ONE signal per conversation, where it fits naturally; everything else stays silent:";
  return `${header}\n${lines.join("\n")}`;
}

// ── Continuity briefing — the agent remembers between calls ────────────────

export type Continuity = {
  lastCheckin?: {
    daysAgo: number;
    summary: string | null;
    energyScore: number | null;
    hadPEMToday: boolean | null;
  } | null;
  lastCrash?: { daysAgo: number; trigger: string | null } | null;
  daypart?: "morning" | "afternoon" | "evening" | null;
};

// d >= 1 always: same-day lastCheckin takes its own branch, lastCrash is 1-4.
const AGO_DE = (d: number) => (d === 1 ? "gestern" : `vor ${d} Tagen`);
const AGO_EN = (d: number) => (d === 1 ? "yesterday" : `${d} days ago`);

/**
 * One compact block: previous check-in (reference it ONCE, warmly), a recent
 * crash to follow up on (replaces the generic crash question), and a daypart
 * note so "this morning" phrasing matches reality. Every line only when the
 * data exists — an empty return leaves the prompt untouched.
 */
export function summarizeContinuityForPrompt(
  c: Continuity | null | undefined,
  locale: string | null | undefined
): string {
  if (!c) return "";
  const de = locale === "de";
  const lines: string[] = [];

  const lc = c.lastCheckin;
  if (lc && lc.daysAgo === 0) {
    // A second check-in TODAY (C3): an update, not a fresh interview.
    lines.push(
      de
        ? `- Sie hat heute schon eingecheckt${lc.summary ? ` („${lc.summary}")` : ""}. Das hier ist ein Update: beziehe dich in EINEM Nebensatz auf vorhin, frag nur, was sich SEITDEM verändert hat, halte es kurz — dann checkin_done.`
        : `- They already checked in earlier today${lc.summary ? ` ("${lc.summary}")` : ""}. This is an update: reference the earlier check-in in ONE clause, ask only what has CHANGED since, keep it short — then checkin_done.`
    );
  } else if (lc && lc.daysAgo >= 3) {
    // A gap (C3): warm welcome back — never guilt, never the old mood.
    lines.push(
      de
        ? `- Letzter Check-in ${AGO_DE(lc.daysAgo)}. Begrüße sie warm zurück — schön, dass sie da ist. Greif die alte Stimmung NICHT wieder auf, erwähne die Pause mit keinem Wort als Versäumnis, kein schlechtes Gewissen, kein Serien-Gerede.`
        : `- Last check-in ${AGO_EN(lc.daysAgo)}. Welcome them back warmly — good to have them here. Do NOT bring up the old mood, never frame the gap as a failure, no guilt, no streak talk.`
    );
  } else if (lc && (lc.summary || lc.energyScore != null)) {
    const bits = [
      lc.summary ? `„${lc.summary}"` : "",
      lc.energyScore != null
        ? de
          ? `Energie ${lc.energyScore}/5`
          : `energy ${lc.energyScore}/5`
        : "",
      lc.hadPEMToday === true ? (de ? "Crash-Tag" : "a crash day") : "",
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(
      de
        ? `- Letzter Check-in (${AGO_DE(lc.daysAgo)}): ${bits}. Beziehe dich EINMAL kurz und warm darauf, wo es natürlich passt („${lc.daysAgo === 1 ? "Gestern" : "Letztes Mal"} klang es ${lc.hadPEMToday || (lc.energyScore ?? 3) <= 2 ? "schwer — wie ist es heute im Vergleich?" : "ganz gut — hält das an?"}") — danach nicht mehr erwähnen.`
        : `- Last check-in (${AGO_EN(lc.daysAgo)}): ${bits}. Reference it ONCE, briefly and warmly, where it fits naturally ("${lc.daysAgo === 1 ? "Yesterday" : "Last time"} sounded ${lc.hadPEMToday || (lc.energyScore ?? 3) <= 2 ? "rough — how does today compare?" : "pretty good — is that holding?"}") — then let it rest.`
    );
  }

  const cr = c.lastCrash;
  if (cr) {
    lines.push(
      de
        ? `- Letzter Crash: ${AGO_DE(cr.daysAgo)}${cr.trigger ? ` (Auslöser: ${cr.trigger})` : ""}. Stell die Crash-Frage als Verlauf, nicht generisch: „Hängt der Crash von ${cr.daysAgo === 1 ? "gestern" : `vor ${cr.daysAgo} Tagen`} noch nach?"`
        : `- Last crash: ${AGO_EN(cr.daysAgo)}${cr.trigger ? ` (trigger: ${cr.trigger})` : ""}. Ask the crash question as a follow-up, not generically: "Is the crash from ${cr.daysAgo === 1 ? "yesterday" : `${cr.daysAgo} days ago`} still lingering?"`
    );
  }

  if (c.daypart === "afternoon" || c.daypart === "evening") {
    const when =
      c.daypart === "afternoon" ? (de ? "Nachmittag" : "afternoon") : de ? "Abend" : "evening";
    lines.push(
      de
        ? `- Es ist bereits ${when} — sag nie „heute Morgen", sprich von „heute" / „der Tag" (in ALLEN Fragen). Nach dem Schlaf der LETZTEN Nacht darfst du trotzdem fragen.`
        : `- It is already ${when} — never say "this morning", say "today" / "your day" (in ALL questions). Still fine to ask about LAST night's sleep.`
    );
    // From the afternoon on the day already has substance — asking about
    // yesterday on top of today is recall load for nothing (morning stays on
    // yesterday; caught by bench/traces context-evening-name-en).
    lines.push(
      de
        ? `- Ab dem Nachmittag zählt der HEUTIGE Tag: Frag bei den Aktivitäten nach heute statt nach gestern.`
        : `- From the afternoon on TODAY is the day that counts: ask about today's activities instead of yesterday's.`
    );
  }

  if (lines.length === 0) return "";
  const header = de
    ? "# Was du von früher weißt\nNutze es beiläufig und warm — nie als Verhör, nie mehrfach:"
    : "# What you remember from before\nUse it casually and warmly — never as an interrogation, never more than once:";
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
  breathlessness: { en: "the breathlessness", de: "die Kurzatmigkeit" },
  // `mood` is intentionally NOT here: an emotional symptom shouldn't be a
  // robotic "rate it 1-5" panel question. It's captured only when she raises
  // it in the open question (extractor maps it); the crisis tool covers acute.
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
  locale: string | null | undefined,
  // The user's own words per category (from past sessions) — the agent asks
  // in THEIR vocabulary ("der Nebel"), not clinical terms.
  words?: Record<string, string> | null
): string {
  if (!panel || panel.length === 0) return "";
  const de = locale === "de";
  const lines = panel
    .filter((c) => PANEL_SPOKEN_NAMES[c])
    .map((c) => {
      const name = de ? PANEL_SPOKEN_NAMES[c].de : PANEL_SPOKEN_NAMES[c].en;
      const w = words?.[c];
      return w
        ? `- ${name} — ${de ? `sie nennt es „${w}" — benutz IHR Wort` : `they call it "${w}" — use THEIR word`}`
        : `- ${name}`;
    });
  if (lines.length === 0) return "";

  // Scale NOT fused into the question — on a good day three "eins bis fünf?"
  // in a row read as a draining rating gauntlet (caught by bench/traces).
  const header = de
    ? `# Ihre verfolgten Symptome (täglich abfragen)
Vor der offenen Frage jedes mit Namen abfragen, eins pro Runde, offen — z. B. „Wie ist der Brain-Fog heute?". Die Skala nur nachschieben, wenn etwas da ist und keine Zahl kam:`
    : `# Their tracked symptoms (ask these daily)
Before the open question, ask each by name, one per turn, openly — e.g. "How's the brain fog today?". Only follow up with the scale when something IS there and no number was given:`;
  return `${header}\n${lines.join("\n")}`;
}

// The onboarding profile's careNote — soft, per-person guidance the person gave
// about themselves (mintToken passes it through metadata). It shapes tone and
// which questions matter; empty string when unset.
export function summarizeProfileForPrompt(
  careNote: string | null | undefined,
  locale: string | null | undefined
): string {
  const note = careNote?.trim();
  if (!note) return "";
  const header = locale === "de" ? "# Über diese Person" : "# About this person";
  return `${header}\n${note}`;
}
