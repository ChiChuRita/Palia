import type { SFSymbol } from "expo-symbols";

// SF Symbol + Apple system color per symptom/activity category. This is what
// gives the History/Today rows the Apple Health look — a colored glyph tile
// leading every row. Keys mirror src/lib/taxonomy.ts; unknown keys fall back
// to a neutral "other" tile.
type IconSpec = { symbol: SFSymbol; color: string };

const FALLBACK: IconSpec = { symbol: "circle.fill", color: "#8E8E93" };

const SYMPTOM_ICONS: Record<string, IconSpec> = {
  fatigue: { symbol: "zzz", color: "#AF52DE" },
  pem: { symbol: "arrow.down.circle.fill", color: "#FF3B30" },
  brain_fog: { symbol: "cloud.fill", color: "#5AC8FA" },
  unrefreshing_sleep: { symbol: "bed.double.fill", color: "#5856D6" },
  pain: { symbol: "bandage.fill", color: "#FF2D55" },
  orthostatic: { symbol: "figure.stand", color: "#FF9500" },
  flu_feeling: { symbol: "thermometer.medium", color: "#00C7BE" },
  breathlessness: { symbol: "lungs.fill", color: "#64D2FF" },
  mood: { symbol: "brain.head.profile", color: "#BF5AF2" },
  other: { symbol: "ellipsis", color: "#8E8E93" },
};

const ACTIVITY_ICONS: Record<string, IconSpec> = {
  rest: { symbol: "cup.and.saucer.fill", color: "#5856D6" },
  household: { symbol: "house.fill", color: "#FF9500" },
  walking: { symbol: "figure.walk", color: "#34C759" },
  cognitive_work: { symbol: "laptopcomputer", color: "#007AFF" },
  social: { symbol: "person.2.fill", color: "#FF2D55" },
  errand: { symbol: "cart.fill", color: "#5AC8FA" },
  other: { symbol: "ellipsis", color: "#8E8E93" },
};

export function categoryIcon(kind: "symptom" | "activity", key: string): IconSpec {
  const map = kind === "symptom" ? SYMPTOM_ICONS : ACTIVITY_ICONS;
  return map[key] ?? FALLBACK;
}
