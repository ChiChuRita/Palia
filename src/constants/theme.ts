/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import "@/global.css";

import { Platform } from "react-native";

/**
 * Apple Health-style grouped palette: screens sit on the grouped background,
 * content lives on `backgroundElement` cards (white / elevated dark gray).
 */
export const Colors = {
  light: {
    text: "#000000",
    background: "#F2F2F7", // systemGroupedBackground
    backgroundElement: "#FFFFFF", // card
    backgroundSelected: "#E5E5EA", // tertiary fill
    textSecondary: "#8A8A8E", // secondaryLabel
    tint: "#007AFF",
  },
  dark: {
    text: "#ffffff",
    background: "#000000",
    backgroundElement: "#1C1C1E", // secondarySystemGroupedBackground
    backgroundSelected: "#2C2C2E",
    textSecondary: "#98989E",
    tint: "#0A84FF",
  },
} as const;

/** Energy score 1–5 (crash → quiet), Apple system colors. Index 0 unused. */
export const ScoreColors = [
  "",
  "#FF3B30", // 1 — crash
  "#FF9500", // 2 — heavy
  "#FFCC00", // 3 — middle
  "#34C759", // 4 — light
  "#00C7BE", // 5 — quiet
] as const;

/** Insight energy-envelope bands. Yellow band renders orange — readable as text on cards. */
export const LevelColors: Record<string, string> = {
  green: "#34C759",
  yellow: "#FF9500",
  red: "#FF3B30",
};

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * One corner-radius scale for the whole app so surfaces feel uniform.
 *   sm   — small inset surfaces (disclaimers, inline notes)
 *   md   — interactive elements (buttons, rows, choices, steppers)
 *   lg   — content cards / panels
 *   pill — fully rounded chips and circular controls
 */
export const Radius = {
  sm: 12,
  md: 16,
  lg: 20,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * Subtle card elevation — the quiet lift that separates Apple Health's white
 * cards from the grouped-gray background. Kept soft (low opacity, gentle
 * radius) so it reads as depth, not drop-shadow. Spread onto a card's style.
 */
export const CardShadow = Platform.select({
  ios: {
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  android: { elevation: 2 },
  default: {},
});
