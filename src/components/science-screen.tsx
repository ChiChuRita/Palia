import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { evidenceForTags, type EvidenceEntry } from "@/lib/evidence";

/**
 * "The science behind this" — shows the curated research that backs the pacing
 * read. Entries whose tags match the current insight are pinned to the top; the
 * rest follow under a "more" heading. Sources are fixed in code (see
 * src/lib/evidence.ts), never produced by the model. Presented as a modal from
 * the Insights card.
 */
export function ScienceScreen({
  highlightTags,
  onClose,
}: {
  highlightTags?: string[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const { pinned, rest } = evidenceForTags(highlightTags);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.headerTitle}>
            {t("science.title")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("common.done")}
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText type="linkPrimary">{t("common.done")}</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
            {t("science.intro")}
          </ThemedText>

          <View style={[styles.disclaimer, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {t("science.disclaimer")}
            </ThemedText>
          </View>

          {pinned.length > 0 ? (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                {t("science.relevantSection")}
              </ThemedText>
              {pinned.map((e) => (
                <EvidenceCard key={e.tag} entry={e} highlighted />
              ))}
            </>
          ) : null}

          {rest.length > 0 ? (
            <>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sectionLabel}>
                {pinned.length > 0 ? t("science.moreSection") : t("science.allSection")}
              </ThemedText>
              {rest.map((e) => (
                <EvidenceCard key={e.tag} entry={e} />
              ))}
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function EvidenceCard({ entry, highlighted }: { entry: EvidenceEntry; highlighted?: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: highlighted ? theme.backgroundSelected : "transparent",
          borderWidth: highlighted ? 1 : 0,
        },
      ]}
    >
      <ThemedText type="smallBold">{t(entry.titleKey)}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.cardSummary}>
        {t(entry.summaryKey)}
      </ThemedText>
      <View style={styles.sources}>
        {entry.sources.map((s) => (
          <Pressable
            key={s.url}
            accessibilityRole="link"
            onPress={() => Linking.openURL(s.url).catch(() => {})}
            style={({ pressed }) => [styles.sourceRow, { opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText type="small" themeColor="textSecondary" style={styles.sourceArrow}>
              ↗
            </ThemedText>
            <ThemedText type="link" style={styles.sourceLabel} numberOfLines={2}>
              {s.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.one,
  },
  headerTitle: { flex: 1 },
  closeBtn: { paddingLeft: Spacing.three, paddingVertical: Spacing.one },
  content: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.two,
  },
  intro: { lineHeight: 18 },
  disclaimer: {
    borderRadius: Radius.sm,
    padding: Spacing.three,
    marginTop: Spacing.one,
  },
  sectionLabel: {
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: Spacing.three,
  },
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.four,
    gap: Spacing.one,
  },
  cardSummary: { lineHeight: 19 },
  sources: { gap: Spacing.one, marginTop: Spacing.two },
  sourceRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.one },
  sourceArrow: { marginTop: 1 },
  sourceLabel: { flex: 1 },
});
