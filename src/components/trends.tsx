import { useQuery } from "convex/react";
import { StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { CardShadow, LevelColors, Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { useDeviceId } from "@/lib/device-id";

import { api } from "@/../convex/_generated/api";

const TREND_DAYS = 14;

// "2026-07-06" → short local day label ("6.7." / "7/6").
function dayLabel(dateKey: string, locale: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return locale === "de" ? `${d}.${m}.` : `${m}/${d}`;
}

/**
 * The Trends sections under the insight card: stability history, crash log,
 * symptom frequency, and overnight signals vs baseline. All charts are plain
 * Views (bars) — honest at this data density, no chart dependency.
 */
export function Trends() {
  const deviceId = useDeviceId();
  const { t, locale } = useTranslation();

  const history = useQuery(api.insights.history, deviceId ? { deviceId } : "skip");
  const snapshots = useQuery(api.health.recentSnapshots, deviceId ? { deviceId } : "skip");
  const symptoms = useQuery(api.sessions.listSymptomsForDevice, deviceId ? { deviceId } : "skip");

  // Nothing yet → say nothing. The insight card above already explains how
  // to get started; empty chart frames would just be noise.
  if (!history?.length && !snapshots?.length) return null;

  return (
    <>
      {history && history.length > 1 ? (
        <StabilityTrend history={history} locale={locale} t={t} />
      ) : null}
      {history?.length ? <CrashLog history={history} locale={locale} t={t} /> : null}
      {symptoms?.length ? <SymptomFrequency symptoms={symptoms} t={t} /> : null}
      {snapshots && snapshots.length > 1 ? (
        <SignalsTrend snapshots={snapshots} locale={locale} t={t} />
      ) : null}
    </>
  );
}

type T = (key: string, options?: Record<string, unknown>) => string;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

// ── Stability score, one bar per day ────────────────────────────────────────

function StabilityTrend({
  history,
  locale,
  t,
}: {
  history: { dateKey: string; stabilityScore: number | null; energyLevel: string }[];
  locale: string;
  t: T;
}) {
  const theme = useTheme();
  const days = [...history].slice(0, TREND_DAYS).reverse(); // oldest → newest
  return (
    <Card title={t("insights.trendTitle")}>
      <View style={styles.barRow}>
        {days.map((d) => (
          <View key={d.dateKey} style={styles.barSlot}>
            {d.stabilityScore != null ? (
              <View
                style={[
                  styles.bar,
                  {
                    height: `${(d.stabilityScore / 5) * 100}%`,
                    backgroundColor: LevelColors[d.energyLevel] ?? theme.backgroundSelected,
                  },
                ]}
              />
            ) : (
              <View style={[styles.barEmpty, { backgroundColor: theme.backgroundSelected }]} />
            )}
          </View>
        ))}
      </View>
      <View style={styles.axisRow}>
        <ThemedText type="small" themeColor="textSecondary">
          {dayLabel(days[0].dateKey, locale)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {dayLabel(days[days.length - 1].dateKey, locale)}
        </ThemedText>
      </View>
    </Card>
  );
}

// ── Crash log: red days + their suspected triggers ─────────────────────────

function CrashLog({
  history,
  locale,
  t,
}: {
  history: { dateKey: string; pemRisk: string; topTrigger: string | null }[];
  locale: string;
  t: T;
}) {
  const crashes = history.filter((h) => h.pemRisk === "high").slice(0, 5);
  return (
    <Card title={t("insights.crashLogTitle")}>
      {crashes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {t("insights.noCrashes")}
        </ThemedText>
      ) : (
        crashes.map((c) => (
          <View key={c.dateKey} style={styles.crashRow}>
            <View style={[styles.dot, { backgroundColor: LevelColors.red }]} />
            <ThemedText type="smallBold">{dayLabel(c.dateKey, locale)}</ThemedText>
            <ThemedText
              type="small"
              themeColor="textSecondary"
              numberOfLines={2}
              style={styles.crashTrigger}
            >
              {c.topTrigger ?? t("insights.noTriggerKnown")}
            </ThemedText>
          </View>
        ))
      )}
    </Card>
  );
}

// ── Symptom frequency, horizontal bars ──────────────────────────────────────

function SymptomFrequency({
  symptoms,
  t,
}: {
  symptoms: { category: string; severity?: number | null }[];
  t: T;
}) {
  const theme = useTheme();
  const counts = new Map<string, number>();
  for (const s of symptoms) {
    if (s.severity === 0) continue; // panel asked, not present that day
    counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length === 0) return null;
  const max = top[0][1];
  return (
    <Card title={t("insights.symptomFreqTitle")}>
      {top.map(([category, count]) => (
        <View key={category} style={styles.freqRow}>
          <ThemedText type="small" style={styles.freqLabel} numberOfLines={1}>
            {t(`symptomCategories.${category}`)}
          </ThemedText>
          <View style={[styles.freqTrack, { backgroundColor: theme.backgroundSelected }]}>
            <View
              style={[
                styles.freqFill,
                { width: `${(count / max) * 100}%`, backgroundColor: theme.tint },
              ]}
            />
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.freqCount}>
            {count}
          </ThemedText>
        </View>
      ))}
    </Card>
  );
}

// ── Overnight signals vs personal baseline ──────────────────────────────────

function SignalsTrend({
  snapshots,
  locale,
  t,
}: {
  snapshots: {
    dateKey: string;
    hrvMs: number | null;
    hrvBaselineMs: number | null;
    restingHrBpm: number | null;
    rhrBaseline7d: number | null | undefined;
  }[];
  locale: string;
  t: T;
}) {
  const days = [...snapshots].slice(0, TREND_DAYS).reverse();
  // Deviation from baseline, clipped to ±25% (HRV) / ±10 bpm (RHR). Up = good.
  const hrv = days.map((d) => ({
    dateKey: d.dateKey,
    frac:
      d.hrvMs != null && d.hrvBaselineMs != null && d.hrvBaselineMs > 0
        ? Math.max(-1, Math.min(1, (d.hrvMs - d.hrvBaselineMs) / d.hrvBaselineMs / 0.25))
        : null,
  }));
  const rhr = days.map((d) => ({
    dateKey: d.dateKey,
    frac:
      d.restingHrBpm != null && d.rhrBaseline7d != null
        ? Math.max(-1, Math.min(1, -(d.restingHrBpm - d.rhrBaseline7d) / 10))
        : null,
  }));
  if (hrv.every((x) => x.frac == null) && rhr.every((x) => x.frac == null)) return null;
  return (
    <Card title={t("insights.signalsTitle")}>
      <DeviationRow label={t("insights.hrvLabel")} points={hrv} />
      <DeviationRow label={t("insights.rhrLabel")} points={rhr} />
      <View style={styles.axisRow}>
        <ThemedText type="small" themeColor="textSecondary">
          {dayLabel(days[0].dateKey, locale)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t("insights.baselineHint")}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {dayLabel(days[days.length - 1].dateKey, locale)}
        </ThemedText>
      </View>
    </Card>
  );
}

// Bars around a center baseline: above = better than usual, below = worse.
function DeviationRow({
  label,
  points,
}: {
  label: string;
  points: { dateKey: string; frac: number | null }[];
}) {
  const theme = useTheme();
  return (
    <View style={styles.devSection}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.devRow}>
        <View style={[styles.devBaseline, { backgroundColor: theme.backgroundSelected }]} />
        {points.map((p) => (
          <View key={p.dateKey} style={styles.devSlot}>
            {p.frac != null ? (
              <View
                style={[
                  styles.devBar,
                  {
                    height: `${Math.max(6, Math.abs(p.frac) * 50)}%`,
                    backgroundColor: p.frac >= 0 ? LevelColors.green : LevelColors.yellow,
                    ...(p.frac >= 0 ? { bottom: "50%" } : { top: "50%" }),
                  },
                ]}
              />
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    padding: Spacing.four,
    gap: Spacing.two,
    ...CardShadow,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 96,
    gap: 4,
    marginTop: Spacing.one,
  },
  // maxWidth keeps a 2-day history from ballooning into giant blocks; with a
  // full fortnight the bars shrink to share the row evenly.
  barSlot: { flex: 1, maxWidth: 28, height: "100%", justifyContent: "flex-end" },
  bar: { borderRadius: 4, minHeight: 6 },
  barEmpty: { height: 6, borderRadius: 3 },
  axisRow: { flexDirection: "row", justifyContent: "space-between" },
  crashRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: 2,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  crashTrigger: { flex: 1 },
  freqRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    paddingVertical: 2,
  },
  freqLabel: { width: 110 },
  freqTrack: { flex: 1, height: 8, borderRadius: 4, overflow: "hidden" },
  freqFill: { height: "100%", borderRadius: 4 },
  freqCount: { width: 20, textAlign: "right" },
  devSection: { gap: 2, marginTop: Spacing.one },
  devRow: { flexDirection: "row", height: 44, gap: 3 },
  devBaseline: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    height: 1,
  },
  devSlot: { flex: 1, height: "100%" },
  devBar: { position: "absolute", left: 0, right: 0, borderRadius: 2, minHeight: 3 },
});
