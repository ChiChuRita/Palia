import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { DAY_MS, startOfLocalDay } from "@/lib/dates";
import { useDeviceId } from "@/lib/device-id";
import { readHealthSnapshot, type HealthSnapshot } from "@/lib/health";

import { api } from "@/../convex/_generated/api";

const SCORE_COLORS = [
  "", // 0 — unused
  "#b85a5a", // 1 — crash
  "#d9974a", // 2 — heavy
  "#c9b97a", // 3 — middle
  "#7ba374", // 4 — light
  "#5a8a5e", // 5 — quiet
] as const;

const LEAF_STAGES = [
  { min: 1, glyph: "🌱", label: "starting" },
  { min: 3, glyph: "🌿", label: "taking root" },
  { min: 7, glyph: "🍃", label: "growing" },
  { min: 14, glyph: "🌳", label: "steady" },
] as const;

function leafFor(streak: number): { glyph: string; label: string } | null {
  if (streak < 1) return null;
  let chosen: (typeof LEAF_STAGES)[number] = LEAF_STAGES[0];
  for (const stage of LEAF_STAGES) {
    if (streak >= stage.min) chosen = stage;
  }
  return chosen;
}

export function TodaySummary() {
  const deviceId = useDeviceId();
  const reduceMotion = useReduceMotion();
  const { t } = useTranslation();
  const now = useMemo(() => Date.now(), []);
  const dayStart = useMemo(() => startOfLocalDay(now), [now]);
  const dayEnd = dayStart + DAY_MS;
  // HealthKit snapshot — read once on mount. Renders nothing if permission
  // wasn't granted or no data is available, so the UI gracefully degrades.
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  useEffect(() => {
    let mounted = true;
    readHealthSnapshot()
      .then((snap) => {
        if (mounted) setHealth(snap);
      })
      .catch(() => {
        /* silent; chips just won't appear */
      });
    return () => {
      mounted = false;
    };
  }, []);

  const snapshot = useQuery(
    api.sessions.todaySnapshot,
    deviceId ? { deviceId, dayStart, dayEnd } : "skip"
  );
  const streak = useQuery(
    api.sessions.restStreak,
    deviceId ? { deviceId, nowMs: now, dayLengthMs: DAY_MS } : "skip"
  );

  const today = snapshot?.today ?? null;
  const yesterday = snapshot?.yesterday ?? null;
  const scoreToday = today?.energyScore ?? null;
  const scoreYesterday = yesterday?.energyScore ?? null;
  const sleepHoursToday = today?.sleepHours ?? null;
  const pemToday = today?.hadPEMToday === true;

  return (
    <View style={styles.container}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.title}>
        {t("today.title")}
      </ThemedText>

      <ScoreDots score={scoreToday} reduceMotion={reduceMotion} size="large" />

      <ThemedText
        type="default"
        style={styles.summary}
        themeColor={scoreToday != null ? "text" : "textSecondary"}
      >
        {today?.summary ? `"${today.summary}"` : scoreToday == null ? t("today.noCheckIn") : "—"}
      </ThemedText>

      {pemToday ||
      sleepHoursToday != null ||
      health?.hrvMs != null ||
      health?.stepsYesterday != null ? (
        <View style={styles.contextRow}>
          {pemToday ? <ContextChip text={t("today.pemToday")} emphasized /> : null}
          {sleepHoursToday != null ? (
            <ContextChip
              text={t("today.sleepHours", {
                value: sleepHoursToday.toFixed(1),
              })}
            />
          ) : null}
          {health?.hrvMs != null ? (
            <ContextChip text={t("today.hrv", { value: health.hrvMs.toString() })} />
          ) : null}
          {health?.stepsYesterday != null ? (
            <ContextChip
              text={t("today.steps", {
                value:
                  health.stepsYesterday >= 1000
                    ? `${(health.stepsYesterday / 1000).toFixed(1)}k`
                    : health.stepsYesterday.toString(),
              })}
            />
          ) : null}
        </View>
      ) : null}

      {scoreYesterday != null ? (
        <View style={styles.yesterdayRow}>
          <ThemedText type="small" themeColor="textSecondary">
            {t("today.yesterday")}
          </ThemedText>
          <ScoreDots score={scoreYesterday} reduceMotion={reduceMotion} size="small" />
        </View>
      ) : null}

      <RestStreak streak={streak ?? null} reduceMotion={reduceMotion} t={t} />
    </View>
  );
}

function ContextChip({ text, emphasized }: { text: string; emphasized?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: emphasized ? theme.backgroundSelected : theme.backgroundElement,
        },
      ]}
    >
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

function ScoreDots({
  score,
  reduceMotion,
  size,
}: {
  score: number | null;
  reduceMotion: boolean;
  size: "large" | "small";
}) {
  const theme = useTheme();
  // Animated opacity per dot — staggered fade-in for the reveal moment.
  const o1 = useSharedValue(reduceMotion ? 1 : 0);
  const o2 = useSharedValue(reduceMotion ? 1 : 0);
  const o3 = useSharedValue(reduceMotion ? 1 : 0);
  const o4 = useSharedValue(reduceMotion ? 1 : 0);
  const o5 = useSharedValue(reduceMotion ? 1 : 0);
  const opacities = [o1, o2, o3, o4, o5];

  useEffect(() => {
    if (reduceMotion) {
      opacities.forEach((o) => (o.value = 1));
      return;
    }
    const filled = score ?? 0;
    opacities.forEach((o, i) => {
      const target = i < filled || score == null ? 1 : 1;
      o.value = withDelay(
        i * 80,
        withTiming(target, {
          duration: 360,
          easing: Easing.inOut(Easing.sin),
        })
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, reduceMotion]);

  const dotSize = size === "large" ? 22 : 10;
  const gap = size === "large" ? Spacing.two : Spacing.one;
  const filled = score ?? 0;
  const color = score == null ? theme.backgroundSelected : SCORE_COLORS[filled];

  return (
    <View style={[styles.dotsRow, { gap }]}>
      {[1, 2, 3, 4, 5].map((i) => {
        const isOn = i <= filled;
        return (
          <AnimatedDot
            key={i}
            opacity={opacities[i - 1]}
            size={dotSize}
            backgroundColor={isOn ? color : theme.backgroundElement}
            borderColor={isOn ? color : theme.backgroundSelected}
          />
        );
      })}
    </View>
  );
}

function AnimatedDot({
  opacity,
  size,
  backgroundColor,
  borderColor,
}: {
  opacity: SharedValue<number>;
  size: number;
  backgroundColor: string;
  borderColor: string;
}) {
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          borderWidth: 1,
          borderColor,
        },
        style,
      ]}
    />
  );
}

function RestStreak({
  streak,
  reduceMotion,
  t,
}: {
  streak: number | null;
  reduceMotion: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const leaf = streak != null ? leafFor(streak) : null;
  if (!leaf || streak == null || streak === 0) {
    return null;
  }

  const label =
    streak === 1
      ? t("today.daysRestingOne", { count: streak })
      : t("today.daysRestingOther", { count: streak });

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(700)}
      style={styles.streakRow}
    >
      <ThemedText style={styles.streakGlyph}>{leaf.glyph}</ThemedText>
      <View>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t("today.withinEnvelope")}
        </ThemedText>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    alignItems: "center",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  title: { letterSpacing: 1.4, textTransform: "uppercase" },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  summary: {
    textAlign: "center",
    fontStyle: "italic",
    paddingHorizontal: Spacing.three,
  },
  yesterdayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  contextRow: {
    flexDirection: "row",
    gap: Spacing.two,
    flexWrap: "wrap",
    justifyContent: "center",
    marginTop: Spacing.one,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  streakRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    marginTop: Spacing.three,
  },
  streakGlyph: { fontSize: 28 },
});
