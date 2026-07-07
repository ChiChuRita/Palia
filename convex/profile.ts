import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { SYMPTOM_CATEGORY_KEYS } from "./taxonomy";

// Onboarding personal-context → profile. The user types a short intro about
// their condition; GPT-5.5 turns it once into a small profile that tunes both
// the voice agent (livekit.ts briefing) and the pacing analyst (insights.ts).
// Optional and fail-open: no key, empty input, or a persistent API error → no
// row written, and everything downstream behaves as before.

type ParsedProfile = {
  excludedSymptoms: string[];
  careNote: string;
  adjustments: string[];
};

// Strict output contract — schema-enforced by the API. excludedSymptoms is
// enum-locked to the taxonomy so the panel filter (livekit.ts) can trust it.
const PROFILE_RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "care_profile",
    strict: true,
    schema: {
      type: "object",
      properties: {
        excludedSymptoms: {
          type: "array",
          items: { type: "string", enum: [...SYMPTOM_CATEGORY_KEYS] },
        },
        careNote: { type: "string" },
        adjustments: { type: "array", items: { type: "string" }, maxItems: 4 },
      },
      required: ["excludedSymptoms", "careNote", "adjustments"],
      additionalProperties: false,
    },
  },
} as const;

function profileSystem(locale: string): string {
  const language = locale === "de" ? "German (informal du-form)" : "English";
  return `# Role
You configure a gentle daily voice check-in companion and a pacing analyst for someone with ME/CFS or Long COVID, based on how they describe themselves in their own words.

# Task
From their words ONLY, produce three things:
- excludedSymptoms: taxonomy keys for symptoms they clearly say they NEVER have or that plainly do not apply. Only include a key when they explicitly rule it out; empty array if unsure.
- careNote: at most ~280 characters, written in ${language}, addressed to the care system (not the user). Capture what helps the companion and the pacing analyst fit this person — their main struggles, how cautious to be, and anything they said about pacing on good vs bad days. It tunes tone and wording ONLY; it is never used to relax safety.
- adjustments: 2-4 short reassuring bullets in ${language}, addressed to the user as "you", naming what you tuned (e.g. "Won't ask about breathlessness", "Will trust your own read on good days"). Keep each under ~8 words.

# Taxonomy keys (with meaning)
fatigue, pem (post-exertional crash), brain_fog, unrefreshing_sleep, pain, orthostatic (dizziness or racing heart when upright), flu_feeling, breathlessness, mood (low mood or anxiety), other.

# Rules
- Never invent conditions, symptoms, severities, or facts they did not state.
- If they said nothing relevant, return an empty excludedSymptoms array, an empty careNote, and a single warm generic adjustment.
- Never give medical advice or name treatments.`;
}

async function callProfileLLM(
  apiKey: string,
  rawContext: string,
  locale: string
): Promise<ParsedProfile> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5.5",
      // Low effort: one-time onboarding extraction, and the user is watching a
      // spinner — keep it to a few seconds, not the analyst's careful "high".
      reasoning_effort: "low",
      response_format: PROFILE_RESPONSE_SCHEMA,
      messages: [
        { role: "system", content: profileSystem(locale) },
        { role: "user", content: rawContext },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("no profile content");
  const parsed = JSON.parse(content) as Record<string, unknown>;

  const excludedSymptoms = Array.isArray(parsed.excludedSymptoms)
    ? (parsed.excludedSymptoms.filter(
        (s): s is string =>
          typeof s === "string" && (SYMPTOM_CATEGORY_KEYS as readonly string[]).includes(s)
      ) as string[])
    : [];
  const careNote = typeof parsed.careNote === "string" ? parsed.careNote.trim().slice(0, 400) : "";
  const adjustments = Array.isArray(parsed.adjustments)
    ? (parsed.adjustments.filter((a) => typeof a === "string" && a.trim()) as string[])
        .map((a) => a.trim().slice(0, 80))
        .slice(0, 4)
    : [];

  return { excludedSymptoms, careNote, adjustments };
}

// Called by the onboarding "tuning" screen. Returns the adjustments so the
// screen can show what it tuned. Fail-open on every error path.
export const processProfile = action({
  args: { deviceId: v.string(), locale: v.string(), rawContext: v.string() },
  handler: async (ctx, args): Promise<{ skipped: boolean; adjustments: string[] }> => {
    const raw = args.rawContext.trim();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!raw || !apiKey) return { skipped: true, adjustments: [] };
    const locale = args.locale === "de" ? "de" : "en";

    let parsed: ParsedProfile | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        parsed = await callProfileLLM(apiKey, raw, locale);
        break;
      } catch (e) {
        console.error(`[profile] attempt ${attempt + 1} failed`, e);
      }
    }
    if (!parsed) return { skipped: true, adjustments: [] };

    await ctx.runMutation(internal.profile.writeProfile, {
      deviceId: args.deviceId,
      locale,
      rawContext: raw,
      excludedSymptoms: parsed.excludedSymptoms,
      careNote: parsed.careNote,
      adjustments: parsed.adjustments,
      model: "gpt-5.5",
    });
    return { skipped: false, adjustments: parsed.adjustments };
  },
});

// Upsert the single per-device profile row.
export const writeProfile = internalMutation({
  args: {
    deviceId: v.string(),
    locale: v.string(),
    rawContext: v.string(),
    excludedSymptoms: v.array(v.string()),
    careNote: v.string(),
    adjustments: v.array(v.string()),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .unique();
    const doc = { ...args, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("profiles", doc);
  },
});

// Read the device's profile (mintToken + the analyst use this). Null when unset.
export const getProfile = internalQuery({
  args: { deviceId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .withIndex("by_device", (q) => q.eq("deviceId", args.deviceId))
      .unique();
  },
});
