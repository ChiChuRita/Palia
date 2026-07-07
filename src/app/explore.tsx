import { useQuery } from "convex/react";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CategoryIcon } from "@/components/category-icon";
import { PressableScale } from "@/components/pressable-scale";
import { EnergyScoreEditor, SessionEditSheet } from "@/components/session-edit-sheet";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  BottomTabInset,
  CardShadow,
  MaxContentWidth,
  Radius,
  ScoreColors,
  Spacing,
} from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { DAY_MS, startOfLocalDay } from "@/lib/dates";
import { useDeviceId } from "@/lib/device-id";

import { api } from "@/../convex/_generated/api";
import type { Doc, Id } from "@/../convex/_generated/dataModel";

function formatDay(ts: number, t: (key: string) => string, locale: string) {
  const today = startOfLocalDay(Date.now());
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today) / DAY_MS);
  if (diff === 0) return t("history.today");
  if (diff === -1) return t("history.yesterday");
  return new Date(ts).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Resolve a category key (e.g. "brain_fog") to a localized label via i18n.
// Falls back to a Title-Cased version of the key if the locale is missing it.
function useCategoryLabel(kind: "symptom" | "activity") {
  const { t } = useTranslation();
  return (key: string) => {
    const path = kind === "symptom" ? "symptomCategories" : "activityCategories";
    const label = t(`${path}.${key}`);
    // i18n-js returns "[missing ...]" when the key isn't found.
    if (!label || label.startsWith("[missing")) {
      return key.replace(/_/g, " ");
    }
    return label;
  };
}

export default function HistoryScreen() {
  const deviceId = useDeviceId();
  const theme = useTheme();
  const { t, locale } = useTranslation();
  const safeAreaInsets = useSafeAreaInsets();
  const insets = {
    ...safeAreaInsets,
    bottom: safeAreaInsets.bottom + BottomTabInset + Spacing.three,
  };
  const symptomLabel = useCategoryLabel("symptom");
  const activityLabel = useCategoryLabel("activity");

  const [now] = useState(() => Date.now());
  const sevenDaysAgo = useMemo(() => startOfLocalDay(now) - 6 * DAY_MS, [now]);

  const sessions = useQuery(api.sessions.listForDevice, deviceId ? { deviceId } : "skip");
  const weekly = useQuery(
    api.sessions.weeklyAggregates,
    deviceId ? { deviceId, sinceMs: sevenDaysAgo } : "skip"
  );

  // Bucket sessions by local day for the weekly pattern strip.
  const weekPattern = useMemo(() => {
    const buckets = new Map<number, number>(); // dayStart -> best score that day
    if (sessions) {
      for (const s of sessions) {
        if (s.status !== "completed" || s.energyScore == null) continue;
        const bucket = startOfLocalDay(s.startedAt);
        const prev = buckets.get(bucket);
        if (prev == null || s.energyScore > prev) {
          buckets.set(bucket, s.energyScore);
        }
      }
    }
    const today = startOfLocalDay(now);
    const cells: { dayStart: number; score: number | null; label: string }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = today - i * DAY_MS;
      cells.push({
        dayStart,
        score: buckets.get(dayStart) ?? null,
        label: new Date(dayStart).toLocaleDateString(locale, { weekday: "narrow" }).charAt(0),
      });
    }
    return cells;
  }, [sessions, now, locale]);

  const completedSessions = useMemo(
    () => (sessions ?? []).filter((s) => s.status === "completed"),
    [sessions]
  );

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
          <ThemedText type="title">{t("history.title")}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t("history.subtitle")}
          </ThemedText>
        </View>

        <Section title={t("history.thisWeek")}>
          <WeekPattern cells={weekPattern} />
          {weekly && (weekly.sleep.nights > 0 || weekly.pemDays > 0) ? (
            <View style={styles.weeklyMeta}>
              {weekly.sleep.avgHours != null ? (
                <MetaPill
                  symbol="bed.double.fill"
                  iconColor="#5856D6"
                  label={t("history.sleep")}
                  value={t("history.avgSleep", {
                    value: weekly.sleep.avgHours.toFixed(1),
                  })}
                />
              ) : null}
              {weekly.pemDays > 0 ? (
                <MetaPill
                  symbol="arrow.down.circle.fill"
                  iconColor="#FF3B30"
                  label={t("history.pemDays")}
                  value={
                    weekly.pemDays === 1
                      ? t("history.pemCountOne", { count: weekly.pemDays })
                      : t("history.pemCountOther", { count: weekly.pemDays })
                  }
                  emphasized
                />
              ) : null}
            </View>
          ) : null}
        </Section>

        <Section title={t("history.commonSymptoms")}>
          {weekly === undefined ? (
            <Loading />
          ) : weekly.symptoms.length === 0 ? (
            <Quiet text={t("history.nothingLogged")} />
          ) : (
            <View style={styles.list}>
              {weekly.symptoms.map((s) => {
                const dayLabel =
                  s.count === 1
                    ? t("history.daysOne", { count: s.count })
                    : t("history.daysOther", { count: s.count });
                const sevPart =
                  s.avgSeverity != null
                    ? ` · ${t("history.avgSeverity", {
                        value: s.avgSeverity.toFixed(1),
                      })}`
                    : "";
                return (
                  <FactRow
                    key={s.category}
                    kind="symptom"
                    category={s.category}
                    primary={symptomLabel(s.category)}
                    secondary={`${dayLabel}${sevPart}`}
                    quote={s.sampleWords[0]}
                  />
                );
              })}
            </View>
          )}
        </Section>

        <Section title={t("history.commonActivities")}>
          {weekly === undefined ? (
            <Loading />
          ) : weekly.activities.length === 0 ? (
            <Quiet text={t("history.nothingLogged")} />
          ) : (
            <View style={styles.list}>
              {weekly.activities.map((a) => {
                const timesLabel =
                  a.count === 1
                    ? t("history.timesOne", { count: a.count })
                    : t("history.timesOther", { count: a.count });
                const exPart =
                  a.avgExertion != null
                    ? ` · ${t("history.avgExertion", {
                        value: a.avgExertion.toFixed(1),
                      })}`
                    : "";
                return (
                  <FactRow
                    key={a.category}
                    kind="activity"
                    category={a.category}
                    primary={activityLabel(a.category)}
                    secondary={`${timesLabel}${exPart}`}
                    quote={a.sampleWords[0]}
                  />
                );
              })}
            </View>
          )}
        </Section>

        <Section title={t("history.recentCheckIns")}>
          {sessions === undefined ? (
            <Loading />
          ) : completedSessions.length === 0 ? (
            <Quiet text={t("history.noCheckIns")} />
          ) : (
            <View style={styles.list}>
              {completedSessions.map((s) => (
                <SessionRow key={s._id} session={s} deviceId={deviceId} t={t} locale={locale} />
              ))}
            </View>
          )}
        </Section>
      </ThemedView>
    </ScrollView>
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

function Loading() {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      …
    </ThemedText>
  );
}

function Quiet({ text }: { text: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.quiet}>
      <ThemedText type="small" themeColor="textSecondary">
        {text}
      </ThemedText>
    </ThemedView>
  );
}

function MetaPill({
  label,
  value,
  emphasized,
  symbol,
  iconColor,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  symbol?: SFSymbol;
  iconColor?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.metaPill,
        {
          backgroundColor: emphasized ? theme.backgroundSelected : theme.backgroundElement,
        },
      ]}
    >
      {symbol ? (
        <View style={[styles.metaIcon, { backgroundColor: iconColor }]}>
          <SymbolView name={symbol} size={16} tintColor="#FFFFFF" weight="semibold" />
        </View>
      ) : null}
      <ThemedText type="default" style={styles.metaLabel}>
        {label}
      </ThemedText>
      <ThemedText type="button">{value}</ThemedText>
    </View>
  );
}

function WeekPattern({
  cells,
}: {
  cells: { dayStart: number; score: number | null; label: string }[];
}) {
  const theme = useTheme();
  const reduceMotion = useReduceMotion();
  return (
    <View style={styles.weekRow}>
      {cells.map((cell, i) => {
        const filled = cell.score != null;
        const color = filled ? ScoreColors[cell.score!] : theme.backgroundElement;
        const border = filled ? color : theme.backgroundSelected;
        return (
          <Animated.View
            key={cell.dayStart}
            entering={reduceMotion ? undefined : FadeIn.duration(280).delay(i * 50)}
            style={styles.weekCell}
          >
            <View style={[styles.weekDot, { backgroundColor: color, borderColor: border }]} />
            <ThemedText type="small" themeColor="textSecondary">
              {cell.label}
            </ThemedText>
          </Animated.View>
        );
      })}
    </View>
  );
}

function FactRow({
  kind,
  category,
  primary,
  secondary,
  quote,
}: {
  kind: "symptom" | "activity";
  category: string;
  primary: string;
  secondary: string;
  quote?: string;
}) {
  return (
    <ThemedView type="backgroundElement" style={styles.factRow}>
      <CategoryIcon kind={kind} category={category} />
      <View style={styles.factRowInfo}>
        <ThemedText type="default">{primary}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {secondary}
        </ThemedText>
        {quote ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.quote}>
            “{quote}”
          </ThemedText>
        ) : null}
      </View>
    </ThemedView>
  );
}

function SessionRow({
  session,
  deviceId,
  t,
  locale,
}: {
  session: Doc<"sessions">;
  deviceId: string | null;
  t: (key: string) => string;
  locale: string;
}) {
  const [expanded, setExpanded] = useState(false);
  // Three edit targets, one at a time:
  // - 'energy' edits the session energy score
  // - {kind:'symptom', id} edits a specific symptom row
  // - {kind:'activity', id} edits a specific activity row
  const [editing, setEditing] = useState<
    | { kind: "energy" }
    | { kind: "symptom"; id: Id<"symptoms"> }
    | { kind: "activity"; id: Id<"activities"> }
    | null
  >(null);
  const symptomLabel = useCategoryLabel("symptom");
  const activityLabel = useCategoryLabel("activity");

  const transcript = useQuery(
    api.sessions.listTranscriptForSession,
    expanded ? { sessionId: session._id } : "skip"
  );
  const sessionSymptoms = useQuery(
    api.sessions.listSymptomsForSession,
    expanded ? { sessionId: session._id } : "skip"
  );
  const sessionActivities = useQuery(
    api.sessions.listActivitiesForSession,
    expanded ? { sessionId: session._id } : "skip"
  );

  return (
    <Animated.View layout={LinearTransition.duration(260)}>
      <ThemedView type="backgroundElement" style={styles.sessionCard}>
        <Pressable onPress={() => setExpanded((v) => !v)} style={styles.sessionHeader}>
          <View style={styles.sessionMeta}>
            <ThemedText type="smallBold">{formatDay(session.startedAt, t, locale)}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {formatTime(session.startedAt)}
            </ThemedText>
          </View>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              if (!deviceId) return;
              setEditing(editing?.kind === "energy" ? null : { kind: "energy" });
            }}
            hitSlop={6}
          >
            <SessionDots score={session.energyScore ?? null} />
          </Pressable>
        </Pressable>

        {editing?.kind === "energy" && deviceId ? (
          <EnergyScoreEditor
            session={session}
            deviceId={deviceId}
            onClose={() => setEditing(null)}
          />
        ) : null}

        {session.summary ? (
          <ThemedText type="default" style={styles.sessionSummary}>
            “{session.summary}”
          </ThemedText>
        ) : null}

        {expanded ? (
          <Animated.View
            entering={FadeIn.duration(220)}
            exiting={FadeOut.duration(160)}
            layout={LinearTransition.duration(260)}
            style={styles.transcript}
          >
            {/* Structured rows — symptom and activity, both editable */}
            {(sessionSymptoms?.length ?? 0) > 0 || (sessionActivities?.length ?? 0) > 0 ? (
              <View style={styles.structuredBlock}>
                {sessionSymptoms?.map((s) => (
                  <View key={s._id}>
                    <EditableRow
                      kind="symptom"
                      category={s.category}
                      label={symptomLabel(s.category)}
                      detail={
                        s.userWords && s.userWords !== symptomLabel(s.category)
                          ? `“${s.userWords}”`
                          : undefined
                      }
                      score={s.severity ?? null}
                      onPress={() => {
                        if (!deviceId) return;
                        setEditing(
                          editing?.kind === "symptom" && editing.id === s._id
                            ? null
                            : { kind: "symptom", id: s._id }
                        );
                      }}
                    />
                    {editing?.kind === "symptom" && editing.id === s._id && deviceId ? (
                      <SessionEditSheet
                        kind="symptom"
                        row={s}
                        deviceId={deviceId}
                        onClose={() => setEditing(null)}
                      />
                    ) : null}
                  </View>
                ))}
                {sessionActivities?.map((a) => (
                  <View key={a._id}>
                    <EditableRow
                      kind="activity"
                      category={a.category}
                      label={activityLabel(a.category)}
                      detail={
                        a.userWords && a.userWords !== activityLabel(a.category)
                          ? `“${a.userWords}”`
                          : undefined
                      }
                      score={a.exertion ?? null}
                      onPress={() => {
                        if (!deviceId) return;
                        setEditing(
                          editing?.kind === "activity" && editing.id === a._id
                            ? null
                            : { kind: "activity", id: a._id }
                        );
                      }}
                    />
                    {editing?.kind === "activity" && editing.id === a._id && deviceId ? (
                      <SessionEditSheet
                        kind="activity"
                        row={a}
                        deviceId={deviceId}
                        onClose={() => setEditing(null)}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {/* Raw transcript */}
            {transcript === undefined ? (
              <Loading />
            ) : transcript.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t("history.noTranscript")}
              </ThemedText>
            ) : (
              transcript.map((m) => (
                <Animated.View
                  key={m._id}
                  entering={FadeIn.duration(220)}
                  style={styles.transcriptRow}
                >
                  <ThemedText type="smallBold" style={styles.transcriptRole}>
                    {m.role === "assistant" ? t("history.agent") : t("history.you")}
                  </ThemedText>
                  <ThemedText type="small" style={styles.transcriptText}>
                    {m.text}
                  </ThemedText>
                </Animated.View>
              ))
            )}
          </Animated.View>
        ) : null}
      </ThemedView>
    </Animated.View>
  );
}

function EditableRow({
  kind,
  category,
  label,
  detail,
  score,
  onPress,
}: {
  kind: "symptom" | "activity";
  category: string;
  label: string;
  detail?: string;
  score: number | null;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      style={[
        styles.editableRow,
        {
          backgroundColor: theme.background,
          borderColor: theme.backgroundSelected,
        },
      ]}
    >
      <CategoryIcon kind={kind} category={category} size={26} />
      <View style={styles.editableRowInfo}>
        <ThemedText type="default">{label}</ThemedText>
        {detail ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.quote}>
            {detail}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.editableScoreDots}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = score != null && n <= score;
          return (
            <View
              key={n}
              style={[
                styles.editableScoreDot,
                {
                  backgroundColor: on ? theme.text : theme.backgroundElement,
                  borderColor: theme.backgroundSelected,
                },
              ]}
            />
          );
        })}
      </View>
    </PressableScale>
  );
}

function SessionDots({ score }: { score: number | null }) {
  const theme = useTheme();
  if (score == null) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        —
      </ThemedText>
    );
  }
  return (
    <View style={styles.sessionDotsRow}>
      {[1, 2, 3, 4, 5].map((i) => {
        const on = i <= score;
        return (
          <View
            key={i}
            style={[
              styles.sessionDot,
              {
                backgroundColor: on ? ScoreColors[score] : theme.backgroundElement,
                borderColor: on ? ScoreColors[score] : theme.backgroundSelected,
              },
            ]}
          />
        );
      })}
    </View>
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
  list: { gap: Spacing.two },
  quiet: { padding: Spacing.three, borderRadius: Radius.sm },
  weekRow: {
    flexDirection: "row",
    gap: Spacing.two,
    justifyContent: "space-between",
  },
  weekCell: {
    alignItems: "center",
    gap: Spacing.one,
    flex: 1,
  },
  weekDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
  },
  weeklyMeta: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.sm,
    gap: Spacing.three,
    ...CardShadow,
  },
  metaIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  metaLabel: { flex: 1 },
  factRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.three,
    borderRadius: Radius.sm,
    gap: Spacing.three,
    ...CardShadow,
  },
  factRowInfo: { flex: 1, gap: Spacing.half },
  quote: { fontStyle: "italic" },
  sessionCard: {
    padding: Spacing.three,
    borderRadius: Radius.sm,
    gap: Spacing.two,
    ...CardShadow,
  },
  sessionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sessionMeta: { gap: Spacing.half },
  sessionSummary: { fontStyle: "italic" },
  sessionDotsRow: { flexDirection: "row", gap: 4 },
  sessionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
  },
  transcript: {
    paddingTop: Spacing.two,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#80808040",
  },
  transcriptRow: { gap: Spacing.half },
  transcriptRole: { textTransform: "uppercase", letterSpacing: 1 },
  transcriptText: { lineHeight: 20 },
  structuredBlock: { gap: Spacing.two, paddingBottom: Spacing.two },
  editableRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: Spacing.three,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
  },
  editableRowInfo: { flex: 1, gap: Spacing.half },
  editableScoreDots: { flexDirection: "row", gap: 4 },
  editableScoreDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
});
