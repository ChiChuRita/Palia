import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from "react-native";

import { ScienceScreen } from "@/components/science-screen";
import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { useDeviceId } from "@/lib/device-id";

import { api } from "@/../convex/_generated/api";

const LEVEL_COLOR: Record<string, string> = {
  green: "#5a8a5e",
  yellow: "#d9974a",
  red: "#b85a5a",
};

const LEVEL_LABEL_KEY: Record<string, string> = {
  green: "insights.levelGreen",
  yellow: "insights.levelYellow",
  red: "insights.levelRed",
};

// Driver phrases arrive lowercase (the heuristic fallback also splices them
// into a running sentence) — uppercase the first letter for the list rows.
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The Stage-2 pacing analyst output. The Insights screen renders the full card:
 * a 1–5 Stability Score hero (Visible-style) with the factors that drove it, a
 * plain-language read, and a link to the curated research. `compact` renders a
 * single tappable row for the Today view (read-only — no analyze button).
 */
export function InsightCard({ compact }: { compact?: boolean }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const deviceId = useDeviceId();
  const [scienceOpen, setScienceOpen] = useState(false);

  const insight = useQuery(api.insights.latestInsight, deviceId ? { deviceId } : "skip");

  const level = insight?.energyLevel ?? null;
  const isAnalyzing = insight?.status === "analyzing";
  const isGray = level === "gray";
  const bandColor = level && LEVEL_COLOR[level] ? LEVEL_COLOR[level] : theme.backgroundSelected;
  const score = insight?.stabilityScore ?? null;

  // ---- Compact (Today view): one quiet, tappable row → Insights tab ----
  if (compact) {
    if (!insight) return null;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate("/insights")}
        style={({ pressed }) => [
          styles.compactRow,
          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: bandColor }]} />
        <View style={styles.compactText}>
          {isAnalyzing ? (
            <ThemedText type="smallBold">{t("insights.analyzingTitle")}</ThemedText>
          ) : (
            <ThemedText type="smallBold">
              {score != null ? `${score.toFixed(1)} · ` : ""}
              {t(LEVEL_LABEL_KEY[insight.energyLevel] ?? "insights.notEnoughData")}
            </ThemedText>
          )}
          {insight.summary ? (
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
              {insight.summary}
            </ThemedText>
          ) : null}
        </View>
      </Pressable>
    );
  }

  // ---- Full (Insights tab) ----
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.kicker}>
        {t("insights.title")}
      </ThemedText>

      {!insight ? (
        <EmptyState t={t} />
      ) : isAnalyzing ? (
        <View style={styles.analyzing}>
          <ActivityIndicator />
          <View style={styles.analyzingText}>
            <ThemedText type="smallBold">{t("insights.analyzingTitle")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
              {t("insights.analyzingBody")}
            </ThemedText>
          </View>
        </View>
      ) : isGray ? (
        <View style={styles.empty}>
          <ThemedText type="smallBold">{t("insights.notEnoughData")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
            {t("insights.notEnoughDataBody")}
          </ThemedText>
        </View>
      ) : (
        <>
          {/* Score hero */}
          <View style={styles.heroRow}>
            <View style={[styles.scoreRing, { borderColor: bandColor }]}>
              <ThemedText type="title" style={[styles.scoreNum, { color: bandColor }]}>
                {score != null ? score.toFixed(1) : "—"}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.scoreOf}>
                / 5
              </ThemedText>
            </View>
            <View style={styles.heroText}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.scoreLabel}>
                {t("insights.scoreLabel")}
              </ThemedText>
              <ThemedText type="subtitle" style={{ color: bandColor }}>
                {t(LEVEL_LABEL_KEY[insight.energyLevel] ?? "insights.levelYellow")}
              </ThemedText>
            </View>
          </View>

          {/* The one thing to act on, first — a calm callout, not a footnote. */}
          {insight.recommendation ? (
            <View
              style={[
                styles.recommendation,
                { backgroundColor: theme.backgroundSelected, borderLeftColor: bandColor },
              ]}
            >
              <ThemedText type="default" style={styles.recommendationText}>
                {insight.recommendation}
              </ThemedText>
            </View>
          ) : null}

          <ThemedText type="default" style={styles.summary}>
            {insight.summary}
          </ThemedText>

          {/* What shaped the score — readable list, not jargon pills. */}
          {insight.scoreDrivers && insight.scoreDrivers.length > 0 ? (
            <View style={styles.drivers}>
              <ThemedText type="small" themeColor="textSecondary" style={styles.driversTitle}>
                {t("insights.driversTitle")}
              </ThemedText>
              {insight.scoreDrivers.map((d, i) => (
                <View key={`${i}-${d}`} style={styles.driverRow}>
                  <View style={[styles.driverBullet, { backgroundColor: bandColor }]} />
                  <ThemedText type="small" style={styles.driverText}>
                    {capitalize(d)}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => setScienceOpen(true)}
            hitSlop={8}
            style={({ pressed }) => [styles.researchLink, { opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText type="link">{t("insights.basedOnResearch")} →</ThemedText>
          </Pressable>
        </>
      )}

      <Modal
        visible={scienceOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setScienceOpen(false)}
      >
        <ScienceScreen
          highlightTags={insight?.evidenceTags ?? []}
          onClose={() => setScienceOpen(false)}
        />
      </Modal>
    </View>
  );
}

function EmptyState({ t }: { t: (k: string) => string }) {
  return (
    <View style={styles.empty}>
      <ThemedText type="smallBold">{t("insights.none")}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
        {t("insights.noneBody")}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  kicker: { letterSpacing: 1.2, textTransform: "uppercase" },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  scoreRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNum: { fontSize: 30, lineHeight: 34 },
  scoreOf: { marginTop: -2 },
  heroText: { flex: 1, gap: 2 },
  scoreLabel: { letterSpacing: 1, textTransform: "uppercase" },
  drivers: {
    gap: Spacing.one,
    marginTop: Spacing.one,
  },
  driversTitle: { letterSpacing: 1, textTransform: "uppercase", marginBottom: 2 },
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  driverBullet: { width: 6, height: 6, borderRadius: 3 },
  driverText: { flex: 1, lineHeight: 18 },
  summary: { lineHeight: 22, marginTop: Spacing.one },
  recommendation: {
    marginTop: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderLeftWidth: 3,
  },
  recommendationText: { lineHeight: 22 },
  researchLink: { marginTop: Spacing.one, alignSelf: "flex-start" },
  analyzing: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  analyzingText: { flex: 1, gap: 2 },
  empty: { gap: Spacing.one, paddingVertical: Spacing.two },
  emptyBody: { lineHeight: 18 },
  compactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
    width: "100%",
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  compactText: { flex: 1, gap: 1 },
});
