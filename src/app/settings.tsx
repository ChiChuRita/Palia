import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { type Locale, setLocale, useTranslation } from "@/i18n";
import { resetOnboarded } from "@/lib/onboarding";

export default function SettingsScreen() {
  const { t, locale } = useTranslation();
  const theme = useTheme();
  const safeAreaInsets = useSafeAreaInsets();
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
          <ThemedText type="subtitle">{t("settings.title")}</ThemedText>
        </View>

        <Section title={t("settings.language")}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.help}>
            {t("settings.languageBody")}
          </ThemedText>
          <View style={styles.choices}>
            <LangChoice locale="de" label={t("onboarding.languageGerman")} current={locale} />
            <LangChoice locale="en" label={t("onboarding.languageEnglish")} current={locale} />
          </View>
        </Section>

        <Section title={t("settings.danger")}>
          <Pressable
            onPress={() => resetOnboarded().catch(() => {})}
            style={({ pressed }) => [
              styles.dangerButton,
              {
                backgroundColor: theme.backgroundElement,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <ThemedText type="default">{t("settings.resetOnboarding")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t("settings.resetOnboardingBody")}
            </ThemedText>
          </Pressable>
        </Section>
      </ThemedView>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText type="smallBold" style={styles.sectionTitle}>
        {title.toUpperCase()}
      </ThemedText>
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
    <Pressable
      onPress={() => setLocale(locale)}
      style={({ pressed }) => [
        styles.choice,
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
      {selected ? (
        <ThemedText type="small" themeColor="textSecondary">
          ✓
        </ThemedText>
      ) : null}
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
    paddingTop: Spacing.four,
    gap: Spacing.five,
  },
  header: { gap: Spacing.one },
  section: { gap: Spacing.two },
  sectionTitle: { letterSpacing: 1.4 },
  help: { lineHeight: 20 },
  choices: { gap: Spacing.two },
  choice: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    borderWidth: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dangerButton: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.half,
  },
});
