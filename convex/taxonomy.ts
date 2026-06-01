// Mirror of src/lib/taxonomy.ts and agent/src/taxonomy.ts. Keep in sync.

export const SYMPTOM_CATEGORY_KEYS = [
  "fatigue",
  "pem",
  "brain_fog",
  "unrefreshing_sleep",
  "pain",
  "orthostatic",
  "flu_feeling",
  "other",
] as const;
export type SymptomCategory = (typeof SYMPTOM_CATEGORY_KEYS)[number];

export const ACTIVITY_CATEGORY_KEYS = [
  "rest",
  "household",
  "walking",
  "cognitive_work",
  "social",
  "errand",
  "other",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORY_KEYS)[number];
