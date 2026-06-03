// Canonical symptom + activity categories. MVP-sized.
//
// We deliberately keep this small. The clinical literature (IOM 2015, CCC,
// DSQ-2) supports 16+ granular symptom categories, but for the MVP we lump
// them — patients don't need fine taxonomy on day one, and a smaller enum
// gives the model fewer wrong choices to make. We can split later when
// real users tell us the lumping hides something.
//
// SINGLE SOURCE OF TRUTH FOR KEYS. The agent and convex sides hold their own
// copies of the same keys (they're separate runtimes that can't import from
// here) — if you change a key here, update:
//   - agent/src/taxonomy.ts
//   - convex/taxonomy.ts
//
// Localized labels live in src/i18n/{en,de}.ts under `symptomCategories.*`
// and `activityCategories.*`.

export const SYMPTOM_CATEGORY_KEYS = [
  // IOM 2015 required cluster
  "fatigue",
  "pem",
  "brain_fog",
  "unrefreshing_sleep",
  // Common cluster (lumped from CCC pain + autonomic + immune)
  "pain", // headache + muscle + joint
  "orthostatic", // POTS + OI + dizziness on standing
  "flu_feeling", // sore throat + lymph + flu-like — distinct immune flare
  // Escape
  "other",
] as const;
export type SymptomCategory = (typeof SYMPTOM_CATEGORY_KEYS)[number];

export const ACTIVITY_CATEGORY_KEYS = [
  "rest",
  "household", // light + heavy chores lumped
  "walking", // short + long lumped
  "cognitive_work",
  "social",
  "errand", // errands + appointments lumped
  "other",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORY_KEYS)[number];

export function isSymptomCategory(s: string): s is SymptomCategory {
  return (SYMPTOM_CATEGORY_KEYS as readonly string[]).includes(s);
}

export function isActivityCategory(s: string): s is ActivityCategory {
  return (ACTIVITY_CATEGORY_KEYS as readonly string[]).includes(s);
}
