// Bot Lab — 5 voice-agent variants for side-by-side A/B testing.
//
// The client picks one (id passed through the LiveKit token metadata). The
// agent (index.ts) reads it, applies the voice / speed / turn-detection to the
// RealtimeModel, and appends the per-locale `style` overlay to the system
// prompt. Keep the IDs in sync with the client list in `src/lib/bots.ts`.
//
// The spread is deliberate: each bot tests a different hypothesis about what a
// calm ME/CFS check-in should feel like (voice timbre, pace, how patient it is
// with long brain-fog pauses, and emotional tone).

export type VariantId = "A" | "B" | "C" | "D" | "E";

export interface TurnDetection {
  type: "server_vad";
  threshold: number;
  prefix_padding_ms: number;
  // How long the user can pause before the agent takes its turn. Higher =
  // more patient (better for brain-fog), but a longer wait before it replies.
  silence_duration_ms: number;
  // We keep this false everywhere: this population should never be talked over.
  interrupt_response: boolean;
}

export interface Variant {
  id: VariantId;
  /** Short display name shown in the picker. */
  label: string;
  /** One-line description of the hypothesis (English; dev-facing). */
  blurb: string;
  /** gpt-realtime voice id. */
  voice: string;
  /** Speaking rate, 0.25–1.5 (1.0 = default). */
  speed: number;
  turnDetection: TurnDetection;
  /** Tone overlay appended to the EN base prompt. */
  styleEn: string;
  /** Tone overlay appended to the DE base prompt. */
  styleDe: string;
}

const td = (threshold: number, silence_duration_ms: number): TurnDetection => ({
  type: "server_vad",
  threshold,
  prefix_padding_ms: 300,
  silence_duration_ms,
  interrupt_response: false,
});

export const VARIANTS: Record<VariantId, Variant> = {
  A: {
    id: "A",
    label: "Marin · Warm",
    blurb: "Newest, most natural voice. Balanced, warm default.",
    voice: "marin",
    speed: 1.0,
    turnDetection: td(0.6, 800),
    styleEn:
      "Your warmth is steady and unhurried — like a calm friend who has all the time in the world.",
    styleDe:
      "Deine Wärme ist ruhig und unaufgeregt — wie ein gelassener Freund, der alle Zeit der Welt hat.",
  },
  B: {
    id: "B",
    label: "Sage · Soothing",
    blurb: "Softest & most patient. Long pauses — for crash days.",
    voice: "sage",
    speed: 0.95,
    turnDetection: td(0.5, 1300),
    styleEn:
      "Speak especially softly and slowly. Leave generous silence and never rush to fill it. Validate more than you ask. On a hard day, fewer questions is the kinder choice.",
    styleDe:
      "Sprich besonders leise und langsam. Lass großzügig Stille und füll sie nie hektisch. Bestätige mehr, als du fragst. An einem schweren Tag sind weniger Fragen die freundlichere Wahl.",
  },
  C: {
    id: "C",
    label: "Coral · Friendly",
    blurb: "A touch brighter & more relational. Companion-like.",
    voice: "coral",
    speed: 1.0,
    turnDetection: td(0.6, 700),
    styleEn:
      "A little more relational and present — a gentle companion, not a form. Still calm and brief, never peppy or bright.",
    styleDe:
      "Etwas nahbarer und präsenter — eine sanfte Begleitung, kein Formular. Trotzdem ruhig und kurz, nie aufgekratzt oder zu munter.",
  },
  D: {
    id: "D",
    label: "Ballad · Tender",
    blurb: "Expressive, emotionally-attuned prosody.",
    voice: "ballad",
    speed: 0.97,
    turnDetection: td(0.55, 1000),
    styleEn:
      "Let a little tender feeling into your voice — attuned and caring, with soft emotional color in how you reflect back.",
    styleDe:
      "Lass etwas zärtliches Gefühl in deine Stimme — einfühlsam und liebevoll, mit sanfter emotionaler Färbung in dem, was du zurückspiegelst.",
  },
  E: {
    id: "E",
    label: "Ash · Grounded",
    blurb: "Calm, steady, plain-spoken. Clear and grounding.",
    voice: "ash",
    speed: 1.0,
    turnDetection: td(0.65, 800),
    styleEn:
      "Steady and grounded. Plain, clear words and an unshakably calm presence that feels safe and solid.",
    styleDe:
      "Ruhig und geerdet. Schlichte, klare Worte und eine unerschütterlich ruhige Präsenz, die sich sicher und stabil anfühlt.",
  },
};

export const DEFAULT_VARIANT: VariantId = "A";

export function getVariant(id: string | null | undefined): Variant {
  if (id && Object.prototype.hasOwnProperty.call(VARIANTS, id)) {
    return VARIANTS[id as VariantId];
  }
  return VARIANTS[DEFAULT_VARIANT];
}

/** Pick the right style overlay for the active locale. */
export function styleForLocale(variant: Variant, locale: string | null | undefined): string {
  return locale === "de" ? variant.styleDe : variant.styleEn;
}
