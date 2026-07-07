import { SymbolView } from "expo-symbols";
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TodaySummary } from "@/components/today-summary";
import { BottomTabInset, CardShadow, Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";
import { useVoiceSession } from "@/hooks/use-voice-session";
import { useTranslation } from "@/i18n";

function borderForState(state: string, fallback: string): string {
  switch (state) {
    case "connecting":
    case "preparing":
    case "ending":
      return "#FF9500"; // amber — not ready for user input yet
    case "listening":
    case "speaking":
      return "#34C759"; // green — call is live
    case "error":
      return "#FF3B30"; // red
    default:
      return fallback;
  }
}

export function VoiceCheckIn({ onSwitchToForm }: { onSwitchToForm?: () => void }) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const { t } = useTranslation();
  const { state, error, start, end, agentLevel, speaker, setSpeaker } = useVoiceSession();

  const active = state !== "idle" && state !== "error";
  const buttonLabel = active ? t("common.end") : t("common.start");

  // ---- Animations ----
  //
  // 1) Idle breath: gentle scale loop while idle. Stops in reduce-motion.
  // 2) Mic hand-off pulse: one slow outward gradient pulse the moment we go
  //    from 'preparing' (agent's turn) to 'listening' (your turn).
  // 3) Tap feedback: subtle scale on press handled by Pressable's `pressed`.
  //
  // Audio-reactive scaling during 'speaking' is deferred — needs to wire
  // through LiveKit's audioLevel from the hook, which is more invasive.
  const breath = useSharedValue(1);
  const handOff = useSharedValue(0);
  // Audio-reactive scale during agent speech. Smoothed JS-side already; we
  // also tween here so we don't snap.
  const reactive = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion || state !== "speaking") {
      reactive.value = withTiming(1, {
        duration: 300,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }
    // Map level 0..1 -> scale 1.0..1.06. Gentle, never bouncy.
    const target = 1 + Math.min(1, agentLevel) * 0.06;
    reactive.value = withTiming(target, {
      duration: 120,
      easing: Easing.out(Easing.cubic),
    });
  }, [agentLevel, state, reduceMotion, reactive]);

  useEffect(() => {
    if (reduceMotion || state !== "idle") {
      cancelAnimation(breath);
      breath.value = withTiming(1, { duration: 400 });
      return;
    }
    breath.value = withRepeat(
      withSequence(
        withTiming(1.04, {
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
        }),
        withTiming(1, {
          duration: 2000,
          easing: Easing.inOut(Easing.sin),
        })
      ),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, reduceMotion]);

  // Detect the transition into 'listening' (mic hand-off) and play one pulse.
  useEffect(() => {
    if (reduceMotion) return;
    if (state === "listening") {
      handOff.value = 0;
      handOff.value = withTiming(1, {
        duration: 700,
        easing: Easing.out(Easing.cubic),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, reduceMotion]);

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breath.value * reactive.value }],
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: handOff.value === 1 ? 0 : 1 - handOff.value,
    transform: [{ scale: 1 + handOff.value * 0.45 }],
  }));

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <TodaySummary />

        <View style={styles.center}>
          <View style={styles.orbWrapper}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pulse,
                {
                  borderColor: borderForState("listening", theme.backgroundSelected),
                },
                pulseStyle,
              ]}
            />
            <Animated.View style={orbStyle}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={buttonLabel}
                onPress={() => (active ? end() : start())}
                style={({ pressed }) => [
                  styles.orb,
                  {
                    backgroundColor: theme.backgroundElement,
                    opacity: pressed ? 0.85 : 1,
                    borderColor: borderForState(state, theme.backgroundSelected),
                    borderWidth: state === "idle" ? 2 : 4,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  },
                ]}
              >
                <ThemedText type="title" style={styles.orbLabel}>
                  {buttonLabel}
                </ThemedText>
              </Pressable>
            </Animated.View>
          </View>

          <ThemedText themeColor="textSecondary" style={styles.stateLabel}>
            {t(`voice.${state}`)}
          </ThemedText>

          {active && Platform.OS === "ios" ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: speaker }}
              accessibilityLabel={t("voice.audioOutput")}
              onPress={() => setSpeaker(!speaker)}
              style={({ pressed }) => [
                styles.speakerToggle,
                { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <SymbolView
                name={speaker ? "speaker.wave.2.fill" : "ear"}
                size={18}
                tintColor={theme.text}
              />
              <ThemedText type="small">
                {t(speaker ? "voice.speaker" : "voice.earpiece")}
              </ThemedText>
            </Pressable>
          ) : null}

          {error ? (
            <ThemedText type="small" style={styles.error}>
              {error}
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.footer}>
          {onSwitchToForm && !active ? (
            <Pressable accessibilityRole="button" onPress={onSwitchToForm} hitSlop={8}>
              <ThemedText type="small" style={{ color: theme.tint }}>
                {t("form.cantTalk")}
              </ThemedText>
            </Pressable>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {t("voice.footerCalm")}
          </ThemedText>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.four,
    flexGrow: 1,
  },
  orbWrapper: {
    width: 220,
    height: 220,
    alignItems: "center",
    justifyContent: "center",
  },
  orb: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    ...CardShadow,
  },
  pulse: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 3,
  },
  orbLabel: { fontWeight: 500 },
  stateLabel: { textAlign: "center" },
  speakerToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 999,
  },
  error: { color: "#FF3B30", textAlign: "center" },
  footer: { alignItems: "center", paddingBottom: Spacing.two, gap: Spacing.two },
});
