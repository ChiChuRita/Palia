import { useMutation } from "convex/react";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InsightCard } from "@/components/insight-card";
import { ThemedText } from "@/components/themed-text";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { DAY_MS, localDateKey, startOfLocalDay } from "@/lib/dates";
import { setDemoMode } from "@/lib/demo-mode";
import { useDeviceId } from "@/lib/device-id";

import { api } from "@/../convex/_generated/api";

// Developer-only demo screen (deliberately not translated): seeds a mock
// health scenario so the class demo reliably shows a red "slow down" or green
// "steady pace" insight regardless of what the watch actually recorded.
// Seeding turns demo mode ON (blocks the real HealthKit sync from overwriting
// the mock snapshot); Clear turns it back off and restores the real-data path.
// Seeding does NOT run the analyst — the insight updates through the real
// product paths only: the voice check-in's auto-analysis, or "Analyze today"
// on the Insights card.

type Phase =
  | { kind: "idle" }
  | { kind: "seeding"; scenario: string }
  | { kind: "seeded"; scenario: string }
  | { kind: "cleared"; deleted: number }
  | { kind: "error"; message: string };

export function DebugScenarios({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const deviceId = useDeviceId();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const seedScenario = useMutation(api.debug.seedScenario);
  const clearScenario = useMutation(api.debug.clearScenario);

  const busy = phase.kind === "seeding";

  const runScenario = async (scenario: "goodDay" | "badDay", label: string) => {
    if (!deviceId || busy) return;
    try {
      setPhase({ kind: "seeding", scenario: label });
      await setDemoMode(true);
      const dateKey = localDateKey(Date.now());
      await seedScenario({ deviceId, dateKey, scenario });
      setPhase({ kind: "seeded", scenario: label });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "something went wrong",
      });
    }
  };

  const runClear = async () => {
    if (!deviceId || busy) return;
    try {
      setPhase({ kind: "seeding", scenario: "clear" });
      const dayStart = startOfLocalDay(Date.now());
      const res = await clearScenario({ deviceId, dayStart, dayEnd: dayStart + DAY_MS });
      await setDemoMode(false);
      setPhase({ kind: "cleared", deleted: res.deleted });
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "something went wrong",
      });
    }
  };

  const statusText = (() => {
    switch (phase.kind) {
      case "idle":
        return "Pick a scenario. Seeding mocks 7 days of health data — the insight updates after your next check-in (or Analyze today on the Insights tab).";
      case "seeding":
        return phase.scenario === "clear" ? "Clearing…" : `Seeding ${phase.scenario}…`;
      case "seeded":
        return `Seeded ${phase.scenario}. Now do a voice check-in — or tap Analyze on the card below — to generate the insight.`;
      case "cleared":
        return `Cleared ${phase.deleted} rows. Demo mode off — real health data flows again.`;
      case "error":
        return `Error: ${phase.message}`;
    }
  })();

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingBottom: insets.bottom + Spacing.six },
      ]}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title">Demo scenarios</ThemedText>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
            <ThemedText type="link">Done</ThemedText>
          </Pressable>
        </View>

        <View style={styles.buttons}>
          <ScenarioButton
            title="Seed: Good day"
            body="Steady HRV, normal resting HR, 7.6h sleep → green, steadier pace."
            disabled={!deviceId || busy}
            onPress={() => runScenario("goodDay", "good day")}
          />
          <ScenarioButton
            title="Seed: Bad day"
            body="HRV −28%, resting HR +9 bpm, 4.4h sleep, errand crash yesterday → red, slow down."
            disabled={!deviceId || busy}
            onPress={() => runScenario("badDay", "bad day")}
          />
          <ScenarioButton
            title="Clear demo data"
            body="Removes seeded rows, today's check-ins (incl. transcripts) + insights, turns demo mode off."
            disabled={!deviceId || busy}
            onPress={runClear}
          />
        </View>

        <View style={styles.statusRow}>
          {busy ? <ActivityIndicator /> : null}
          <ThemedText
            type="small"
            themeColor={phase.kind === "error" ? "text" : "textSecondary"}
            style={styles.statusText}
          >
            {statusText}
          </ThemedText>
        </View>

        <InsightCard />
      </View>
    </ScrollView>
  );
}

function ScenarioButton({
  title,
  body,
  disabled,
  onPress,
}: {
  title: string;
  body: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: theme.backgroundElement,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <ThemedText type="default">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {body}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrollView: { flex: 1 },
  contentContainer: {
    flexDirection: "row",
    justifyContent: "center",
  },
  container: {
    maxWidth: MaxContentWidth,
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    gap: Spacing.four,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  buttons: { gap: Spacing.two },
  button: {
    padding: Spacing.three,
    borderRadius: Radius.md,
    gap: Spacing.half,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  statusText: { flex: 1, lineHeight: 18 },
});
