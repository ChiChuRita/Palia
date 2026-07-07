import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DebugScenarios } from "@/components/debug-scenarios";
import { PressableScale } from "@/components/pressable-scale";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TimeStepper } from "@/components/time-stepper";
import { BottomTabInset, CardShadow, MaxContentWidth, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { type Locale, setLocale, useTranslation } from "@/i18n";
import { resetOnboarded } from "@/lib/onboarding";
import { disableReminder, enableReminder, setReminderTime, useReminder } from "@/lib/reminders";

export default function SettingsScreen() {
  const { t, locale } = useTranslation();
  const theme = useTheme();
  const reminder = useReminder();
  const safeAreaInsets = useSafeAreaInsets();
  const [debugOpen, setDebugOpen] = useState(false);

  const onToggleReminder = (value: boolean) => {
    if (value) {
      enableReminder(reminder.hour, reminder.minute).catch(() => {});
    } else {
      disableReminder().catch(() => {});
    }
  };
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };

  const contentPlatformStyle = Platform.select({
    android: {
      paddingTop: insets.top,
      paddingLeft: insets.left,
      paddingRight: insets.right,
      paddingBottom: insets.bottom,
    },
    web: { paddingTop: Spacing.six, paddingBottom: Spacing.four },
  });

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentInset={insets}
      contentContainerStyle={[styles.contentContainer, contentPlatformStyle]}
    >
      <ThemedView style={styles.container}>
        <View style={styles.header}>
          <ThemedText type="title">{t("settings.title")}</ThemedText>
        </View>

        <Section title={t("settings.name")}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.help}>
            {t("settings.nameBody")}
          </ThemedText>
          <NameField placeholder={t("settings.namePlaceholder")} />
        </Section>

        <Section title={t("settings.language")}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.help}>
            {t("settings.languageBody")}
          </ThemedText>
          <View style={styles.choices}>
            <LangChoice locale="de" label={t("onboarding.languageGerman")} current={locale} />
            <LangChoice locale="en" label={t("onboarding.languageEnglish")} current={locale} />
          </View>
        </Section>

        <Section title={t("settings.reminder")}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.help}>
            {t("settings.reminderBody")}
          </ThemedText>
          <View style={styles.toggleRow}>
            <ThemedText type="default">{t("settings.reminderEnable")}</ThemedText>
            <Switch value={reminder.enabled} onValueChange={onToggleReminder} />
          </View>
          {reminder.enabled ? (
            <View style={styles.reminderTime}>
              <ThemedText type="small" themeColor="textSecondary">
                {t("settings.reminderAt")}
              </ThemedText>
              <TimeStepper
                hour={reminder.hour}
                minute={reminder.minute}
                onChange={(h, m) => setReminderTime(h, m).catch(() => {})}
              />
            </View>
          ) : null}
        </Section>

        <Section title={t("settings.danger")}>
          <PressableScale
            onPress={() => resetOnboarded().catch(() => {})}
            style={[styles.dangerButton, { backgroundColor: theme.backgroundElement }]}
          >
            <ThemedText type="default">{t("settings.resetOnboarding")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t("settings.resetOnboardingBody")}
            </ThemedText>
          </PressableScale>
        </Section>

        {/* Developer-only demo controls — deliberately untranslated. */}
        <Section title="Developer">
          <PressableScale
            onPress={() => setDebugOpen(true)}
            style={[styles.dangerButton, { backgroundColor: theme.backgroundElement }]}
          >
            <ThemedText type="default">Demo scenarios</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Seed mock health data (good day / bad day) for the demo.
            </ThemedText>
          </PressableScale>
        </Section>

        <Modal
          visible={debugOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setDebugOpen(false)}
        >
          <DebugScenarios onClose={() => setDebugOpen(false)} />
        </Modal>
      </ThemedView>
    </ScrollView>
  );
}

// First-name field — stored locally, sent only in the voice-token metadata so
// the agent can greet by name ("Guten Morgen, Rahul.").
function NameField({ placeholder }: { placeholder: string }) {
  const theme = useTheme();
  const [name, setName] = useState("");
  useEffect(() => {
    AsyncStorage.getItem("mecfs:userName")
      .then((v) => setName(v ?? ""))
      .catch(() => {});
  }, []);
  const save = (v: string) => {
    setName(v);
    const trimmed = v.trim().slice(0, 40);
    (trimmed
      ? AsyncStorage.setItem("mecfs:userName", trimmed)
      : AsyncStorage.removeItem("mecfs:userName")
    ).catch(() => {});
  };
  return (
    <TextInput
      value={name}
      onChangeText={save}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      autoCapitalize="words"
      autoComplete="given-name"
      style={[
        styles.nameInput,
        { backgroundColor: theme.backgroundElement, color: theme.text },
      ]}
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="heading">{title}</ThemedText>
      {children}
    </View>
  );
}

function LangChoice({
  locale,
  label,
  current,
}: {
  locale: Locale;
  label: string;
  current: Locale;
}) {
  const theme = useTheme();
  const selected = current === locale;
  return (
    <PressableScale
      onPress={() => setLocale(locale)}
      style={[
        styles.choice,
        {
          backgroundColor: selected ? theme.backgroundSelected : theme.backgroundElement,
          borderColor: selected ? theme.text : "transparent",
        },
      ]}
    >
      <ThemedText type={selected ? "button" : "default"}>{label}</ThemedText>
      {selected ? (
        <ThemedText type="small" themeColor="tint">
          ✓
        </ThemedText>
      ) : null}
    </PressableScale>
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
    paddingTop: Spacing.four,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  section: { gap: Spacing.two },
  help: { lineHeight: 20 },
  toggleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: Spacing.one,
  },
  reminderTime: { gap: Spacing.two, marginTop: Spacing.one, alignItems: "center" },
  choices: { gap: Spacing.two },
  choice: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    borderWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    ...CardShadow,
  },
  dangerButton: {
    padding: Spacing.three,
    borderRadius: Radius.md,
    gap: Spacing.half,
    ...CardShadow,
  },
  nameInput: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    fontSize: 16,
    ...CardShadow,
  },
});
