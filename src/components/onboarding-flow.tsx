// import { mediaDevices } from "@livekit/react-native-webrtc";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";
import { type Locale, setLocale, useTranslation } from "@/i18n";
import { requestHealthPermission } from "@/lib/health";

// Triggers the iOS mic permission prompt and immediately stops the track.
// We don't want to keep recording — just to get the system dialog out of the
// way during onboarding so the first "Start" tap doesn't pop a prompt mid-call.
async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    // Browsers handle permissions natively on first use, or use standard web APIs
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    }
  }

  try {
    // Lazy-require the native module ONLY when on iOS/Android
    const { mediaDevices } = require("@livekit/react-native-webrtc");
    const stream = await mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t: any) => t.stop());
    return true;
  } catch {
    // Denied or unavailable. We still let the user continue — they can grant
    // later from Settings, and the voice-session error path handles failure.
    return false;
  }
}

type Step = "welcome" | "language" | "mic" | "health" | "done";

export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [requestingMic, setRequestingMic] = useState(false);
  const [requestingHealth, setRequestingHealth] = useState(false);
  const { t } = useTranslation();
  const theme = useTheme();
  const reduceMotion = useReduceMotion();

  const next = (s: Step) => setStep(s);

  const onAllowMic = async () => {
    setRequestingMic(true);
    await requestMicPermission();
    setRequestingMic(false);
    setStep("health");
  };

  const onAllowHealth = async () => {
    setRequestingHealth(true);
    await requestHealthPermission();
    setRequestingHealth(false);
    onDone();
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.body}>
          {step === "welcome" ? (
            <Screen reduceMotion={reduceMotion} key="welcome">
              <ThemedText type="title" style={styles.title}>
                {t("onboarding.welcomeTitle")}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.body_text}>
                {t("onboarding.welcomeBody")}
              </ThemedText>
            </Screen>
          ) : null}

          {step === "language" ? (
            <Screen reduceMotion={reduceMotion} key="language">
              <ThemedText type="title" style={styles.title}>
                {t("onboarding.chooseLanguage")}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.body_text}>
                {t("onboarding.chooseLanguageBody")}
              </ThemedText>
              <View style={styles.choices}>
                <LangChoice locale="de" label={t("onboarding.languageGerman")} />
                <LangChoice locale="en" label={t("onboarding.languageEnglish")} />
              </View>
            </Screen>
          ) : null}

          {step === "mic" ? (
            <Screen reduceMotion={reduceMotion} key="mic">
              <ThemedText type="title" style={styles.title}>
                {t("onboarding.micTitle")}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.body_text}>
                {t("onboarding.micBody")}
              </ThemedText>
            </Screen>
          ) : null}

          {step === "health" ? (
            <Screen reduceMotion={reduceMotion} key="health">
              <ThemedText type="title" style={styles.title}>
                {Platform.select({
                  ios: t("onboarding.healthTitle"), // "Apple Health Integration"
                  android: t("onboarding.healthConnectTitle") || "Google Health Connect",
                })}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary" style={styles.body_text}>
                {Platform.select({
                  ios: t("onboarding.healthBody"),
                  android:
                    t("onboarding.healthConnectBody") ||
                    "Used to gently reference your sleep, HRV, resting heart rate and activity. We only read — we never write. Skipping is fine if you don't use a smartwatch.",
                })}
              </ThemedText>
            </Screen>
          ) : null}
        </View>

        <View style={styles.footer}>
          {step === "welcome" ? (
            <PrimaryButton
              label={t("common.continue")}
              onPress={() => next("language")}
              theme={theme}
            />
          ) : step === "language" ? (
            <PrimaryButton label={t("common.continue")} onPress={() => next("mic")} theme={theme} />
          ) : step === "mic" ? (
            <View style={styles.row}>
              <SecondaryButton
                label={t("onboarding.micSkip")}
                onPress={() => setStep("health")}
                theme={theme}
              />
              <PrimaryButton
                label={requestingMic ? t("common.loading") : t("onboarding.micGrant")}
                onPress={onAllowMic}
                theme={theme}
                disabled={requestingMic}
              />
            </View>
          ) : step === "health" ? (
            <View style={styles.row}>
              <SecondaryButton label={t("onboarding.healthSkip")} onPress={onDone} theme={theme} />
              <PrimaryButton
                label={requestingHealth ? t("common.loading") : t("onboarding.healthGrant")}
                onPress={onAllowHealth}
                theme={theme}
                disabled={requestingHealth}
              />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

function Screen({ children, reduceMotion }: { children: React.ReactNode; reduceMotion: boolean }) {
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeIn.duration(360)}
      exiting={reduceMotion ? undefined : FadeOut.duration(180)}
      style={styles.screen}
    >
      {children}
    </Animated.View>
  );
}

function LangChoice({ locale, label }: { locale: Locale; label: string }) {
  const theme = useTheme();
  const { locale: current } = useTranslation();
  const selected = current === locale;
  return (
    <Pressable
      onPress={() => setLocale(locale)}
      style={({ pressed }) => [
        styles.langChoice,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: selected ? theme.text : "transparent",
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <ThemedText type="default" style={{ fontWeight: selected ? 600 : 500 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function PrimaryButton({
  label,
  onPress,
  theme,
  disabled,
}: {
  label: string;
  onPress: () => void;
  theme: { text: string; background: string };
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primary,
        {
          backgroundColor: theme.text,
          opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed && !disabled ? 0.98 : 1 }],
        },
      ]}
    >
      <ThemedText type="default" style={{ color: theme.background, fontWeight: 600 }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function SecondaryButton({
  label,
  onPress,
  theme,
}: {
  label: string;
  onPress: () => void;
  theme: { backgroundElement: string };
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.secondary,
        {
          backgroundColor: theme.backgroundElement,
          opacity: pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <ThemedText type="default" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    width: "100%",
  },
  body: { flex: 1, justifyContent: "center" },
  screen: { gap: Spacing.three, alignItems: "center" },
  title: { textAlign: "center" },
  body_text: { textAlign: "center", lineHeight: 26 },
  choices: { gap: Spacing.two, alignSelf: "stretch", marginTop: Spacing.three },
  langChoice: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
    alignItems: "center",
    borderWidth: 2,
  },
  footer: {
    paddingVertical: Spacing.four,
    gap: Spacing.two,
  },
  row: { flexDirection: "row", gap: Spacing.two },
  primary: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: 999,
    alignItems: "center",
    flexGrow: 1,
  },
  secondary: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
    alignItems: "center",
  },
});
