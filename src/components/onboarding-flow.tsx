// import { mediaDevices } from "@livekit/react-native-webrtc";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAction } from "convex/react";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/../convex/_generated/api";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TimeStepper } from "@/components/time-stepper";
import { MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";
import { type Locale, setLocale, useTranslation } from "@/i18n";
import { useDeviceId } from "@/lib/device-id";
import { requestHealthPermission } from "@/lib/health";
import { DEFAULT_REMINDER_HOUR, DEFAULT_REMINDER_MINUTE, enableReminder } from "@/lib/reminders";

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
    const { mediaDevices } = await import("@livekit/react-native-webrtc");
    const stream = await mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t: any) => t.stop());
    return true;
  } catch {
    // Denied or unavailable. We still let the user continue — they can grant
    // later from Settings, and the voice-session error path handles failure.
    return false;
  }
}

type Step = "welcome" | "language" | "about" | "tuning" | "mic" | "health" | "reminder" | "done";

export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>("welcome");
  const [requestingMic, setRequestingMic] = useState(false);
  const [requestingHealth, setRequestingHealth] = useState(false);
  const [requestingReminder, setRequestingReminder] = useState(false);
  const [remHour, setRemHour] = useState(DEFAULT_REMINDER_HOUR);
  const [remMinute, setRemMinute] = useState(DEFAULT_REMINDER_MINUTE);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  // null = still processing; string[] = done (the bullets to reveal).
  const [adjustments, setAdjustments] = useState<string[] | null>(null);
  const { t, locale } = useTranslation();
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  const deviceId = useDeviceId();
  const processProfile = useAction(api.profile.processProfile);

  const next = (s: Step) => setStep(s);

  // Save the name on-device (same key Settings + the voice token use), then run
  // the one-time profile processing. Fail-open: no text or no deviceId → skip
  // straight to mic; an API error lands us on mic too.
  const onSubmitAbout = async () => {
    const trimmedName = name.trim().slice(0, 40);
    (trimmedName
      ? AsyncStorage.setItem("mecfs:userName", trimmedName)
      : AsyncStorage.removeItem("mecfs:userName")
    ).catch(() => {});
    const raw = about.trim();
    if (!raw || !deviceId) {
      setStep("mic");
      return;
    }
    setAdjustments(null);
    setStep("tuning");
    // If the user hit Skip while this was in flight, don't yank them back —
    // only advance/fall through when we're still sitting on the tuning screen.
    const fallThrough = () => setStep((s) => (s === "tuning" ? "mic" : s));
    try {
      const res = await processProfile({ deviceId, locale, rawContext: raw });
      if (!res.adjustments?.length) fallThrough();
      else setAdjustments(res.adjustments);
    } catch {
      fallThrough();
    }
  };

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
    setStep("reminder");
  };

  const onAllowReminder = async () => {
    setRequestingReminder(true);
    // Even if permission is denied, the chosen time is remembered so the user
    // can flip it on later from Settings without re-picking.
    await enableReminder(remHour, remMinute);
    setRequestingReminder(false);
    onDone();
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* Keeps the footer button visible above the iOS keyboard on the
            "about" step — the only screen here with text input. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
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

            {step === "about" ? (
              <Screen reduceMotion={reduceMotion} key="about">
                <ThemedText type="title" style={styles.title}>
                  {t("onboarding.aboutTitle")}
                </ThemedText>
                <ThemedText type="default" themeColor="textSecondary" style={styles.body_text}>
                  {t("onboarding.aboutBody")}
                </ThemedText>
                <View style={styles.fields}>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder={t("settings.namePlaceholder")}
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="words"
                    autoComplete="given-name"
                    maxLength={40}
                    style={[
                      styles.input,
                      { color: theme.text, backgroundColor: theme.backgroundElement },
                    ]}
                  />
                  <TextInput
                    value={about}
                    onChangeText={setAbout}
                    placeholder={t("onboarding.aboutPlaceholder")}
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="sentences"
                    multiline
                    maxLength={600}
                    style={[
                      styles.textArea,
                      { color: theme.text, backgroundColor: theme.backgroundElement },
                    ]}
                  />
                </View>
              </Screen>
            ) : null}

            {step === "tuning" ? (
              <Screen reduceMotion={reduceMotion} key="tuning">
                <ThemedText type="title" style={styles.title}>
                  {t("onboarding.tuningTitle")}
                </ThemedText>
                {adjustments === null ? (
                  <>
                    <ActivityIndicator />
                    <ThemedText type="default" themeColor="textSecondary" style={styles.body_text}>
                      {t("onboarding.tuningBody")}
                    </ThemedText>
                  </>
                ) : (
                  <View style={styles.adjustments}>
                    {adjustments.map((a, i) => (
                      <Animated.View
                        key={i}
                        entering={reduceMotion ? undefined : FadeIn.delay(i * 220).duration(360)}
                      >
                        <ThemedText type="default">{`✓  ${a}`}</ThemedText>
                      </Animated.View>
                    ))}
                  </View>
                )}
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
                    android: t("onboarding.healthTitle") || "Google Health Connect",
                  })}
                </ThemedText>
                <ThemedText type="default" themeColor="textSecondary" style={styles.body_text}>
                  {Platform.select({
                    ios: t("onboarding.healthBody"),
                    android:
                      t("onboarding.healthBody") ||
                      "Used to gently reference your sleep, HRV, resting heart rate and activity. We only read — we never write. Skipping is fine if you don't use a smartwatch.",
                  })}
                </ThemedText>
              </Screen>
            ) : null}

            {step === "reminder" ? (
              <Screen reduceMotion={reduceMotion} key="reminder">
                <ThemedText type="title" style={styles.title}>
                  {t("onboarding.reminderTitle")}
                </ThemedText>
                <ThemedText type="default" themeColor="textSecondary" style={styles.body_text}>
                  {t("onboarding.reminderBody")}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.reminderLabel}>
                  {t("onboarding.reminderEvery")}
                </ThemedText>
                <TimeStepper
                  hour={remHour}
                  minute={remMinute}
                  onChange={(h, m) => {
                    setRemHour(h);
                    setRemMinute(m);
                  }}
                />
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
              <PrimaryButton
                label={t("common.continue")}
                onPress={() => next("about")}
                theme={theme}
              />
            ) : step === "about" ? (
              <PrimaryButton label={t("common.continue")} onPress={onSubmitAbout} theme={theme} />
            ) : step === "tuning" ? (
              adjustments === null ? (
                // Escape hatch while GPT processes — a hung network call must
                // never strand the user on a spinner. The profile still lands
                // server-side if the action eventually succeeds.
                <SecondaryButton
                  label={t("common.skip")}
                  onPress={() => next("mic")}
                  theme={theme}
                />
              ) : (
                <PrimaryButton
                  label={t("common.continue")}
                  onPress={() => next("mic")}
                  theme={theme}
                />
              )
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
                <SecondaryButton
                  label={t("onboarding.healthSkip")}
                  onPress={() => setStep("reminder")}
                  theme={theme}
                />
                <PrimaryButton
                  label={requestingHealth ? t("common.loading") : t("onboarding.healthGrant")}
                  onPress={onAllowHealth}
                  theme={theme}
                  disabled={requestingHealth}
                />
              </View>
            ) : step === "reminder" ? (
              <View style={styles.row}>
                <SecondaryButton
                  label={t("onboarding.reminderSkip")}
                  onPress={onDone}
                  theme={theme}
                />
                <PrimaryButton
                  label={requestingReminder ? t("common.loading") : t("onboarding.reminderGrant")}
                  onPress={onAllowReminder}
                  theme={theme}
                  disabled={requestingReminder}
                />
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
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
      <ThemedText type={selected ? "button" : "default"}>{label}</ThemedText>
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
      <ThemedText type="button" style={{ color: theme.background }}>
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
  flex: { flex: 1 },
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
  reminderLabel: {
    marginTop: Spacing.two,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  choices: { gap: Spacing.two, alignSelf: "stretch", marginTop: Spacing.three },
  fields: { gap: Spacing.two, alignSelf: "stretch", marginTop: Spacing.three },
  input: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    fontSize: 16,
  },
  textArea: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: "top",
  },
  adjustments: { gap: Spacing.two, alignSelf: "stretch", marginTop: Spacing.two },
  langChoice: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
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
