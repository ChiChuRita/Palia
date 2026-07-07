import { useMutation, useQuery } from "convex/react";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { InsightCard } from "@/components/insight-card";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { CardShadow, Radius, ScoreColors, Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { DAY_MS, localDateKey, startOfLocalDay } from "@/lib/dates";
import { isDemoMode } from "@/lib/demo-mode";
import { useDeviceId } from "@/lib/device-id";
import { readHealthSnapshot, type HealthSnapshot } from "@/lib/health";

import { api } from "@/../convex/_generated/api";

export function TodaySummary() {
  const deviceId = useDeviceId();
  const reduceMotion = useReduceMotion();
  const { t } = useTranslation();
  const [now] = useState(() => Date.now());
  const dayStart = useMemo(() => startOfLocalDay(now), [now]);
  const dayEnd = dayStart + DAY_MS;
  // HealthKit snapshot — read once on mount. Not rendered anywhere on this
  // screen (the home screen stays silent on biomarkers; the Insights tab
  // interprets them) — it exists solely to feed the Stage-2 analyst below.
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

  // Persist today's passive-health snapshot to Convex once both the device id
  // and the HealthKit read are ready. This is what the Stage-2 analyst reads.
  // Skipped while demo mode is on — the real read would overwrite the seeded
  // scenario snapshot.
  const upsertSnapshot = useMutation(api.health.upsertSnapshot);
  const syncedRef = useRef(false);
  useEffect(() => {
    if (syncedRef.current || !deviceId || !health) return;
    let cancelled = false;
    isDemoMode().then((demo) => {
      if (cancelled || demo || syncedRef.current) return;
      syncedRef.current = true;
      upsertSnapshot({
        deviceId,
        dateKey: localDateKey(Date.now()),
        hrvMs: health.hrvMs,
        hrvBaselineMs: health.hrvBaselineMs,
        restingHrBpm: health.restingHrBpm,
        // Never persist a stale sleep sample as last night's — the analyst
        // would fire a red "only X hours" flag off a night the watch never
        // saw (the sleepIsLastNight guard otherwise only protects the voice
        // briefing). null = unknown, same as no sleep data.
        sleepHours: health.sleepIsLastNight === false ? null : health.sleepHoursLastNight,
        steps: health.stepsYesterday,
      }).catch(() => {
        syncedRef.current = false; // allow a retry on next render
      });
    });
    return () => {
      cancelled = true;
    };
  }, [deviceId, health, upsertSnapshot]);

  const snapshot = useQuery(
    api.sessions.todaySnapshot,
    deviceId ? { deviceId, dayStart, dayEnd } : "skip"
  );

  const today = snapshot?.today ?? null;
  const scoreToday = today?.energyScore ?? null;
  const sleepHoursToday = today?.sleepHours ?? null;
  const pemToday = today?.hadPEMToday === true;

  return (
    <ThemedView type="backgroundElement" style={styles.container}>
      <ThemedText type="smallBold" themeColor="textSecondary">
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

      {pemToday || sleepHoursToday != null ? (
        <View style={styles.contextRow}>
          {pemToday ? (
            <ContextChip
              symbol="arrow.down.circle.fill"
              iconColor="#FF3B30"
              text={t("today.pemToday")}
              emphasized
            />
          ) : null}
          {sleepHoursToday != null ? (
            <ContextChip
              symbol="bed.double.fill"
              iconColor="#5856D6"
              text={t("today.sleepHours", {
                value: sleepHoursToday.toFixed(1),
              })}
            />
          ) : null}
        </View>
      ) : null}

      <View style={styles.insightSlot}>
        <InsightCard compact />
      </View>
    </ThemedView>
  );
}

function ContextChip({
  text,
  emphasized,
  symbol,
  iconColor,
}: {
  text: string;
  emphasized?: boolean;
  symbol?: SFSymbol;
  iconColor?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: emphasized ? theme.backgroundSelected : theme.background,
        },
      ]}
    >
      {symbol ? (
        <SymbolView name={symbol} size={15} tintColor={iconColor} weight="semibold" />
      ) : null}
      <ThemedText type="smallBold">{text}</ThemedText>
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
  const color = score == null ? theme.backgroundSelected : ScoreColors[filled];

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

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
    alignItems: "center",
    padding: Spacing.four,
    borderRadius: Radius.md,
    ...CardShadow,
  },
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
  contextRow: {
    flexDirection: "row",
    gap: Spacing.two,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  insightSlot: { width: "100%" },
});
