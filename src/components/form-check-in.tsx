// Non-voice check-in: the daily checklist as a one-question-per-screen wizard.
// Mirrors the voice flow's order (sleep → crash → symptoms → yesterday →
// energy) and submits everything through sessions.submitManualCheckIn.

import { useMutation } from "convex/react";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { CategoryIcon } from "@/components/category-icon";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, Radius, ScoreColors, Spacing } from "@/constants/theme";
import { useReduceMotion } from "@/hooks/use-reduce-motion";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";
import { useDeviceId } from "@/lib/device-id";
import { ACTIVITY_CATEGORY_KEYS, SYMPTOM_CATEGORY_KEYS } from "@/lib/taxonomy";

import { api } from "@/../convex/_generated/api";

const SLEEP_DEFAULT = 7;
const SLEEP_STEP = 0.5;
const SLEEP_MAX = 14;

// Selected categories map to their 1–5 score; null = selected, score not
// picked yet (Next stays disabled until every selected row has one).
type Scores = Record<string, number | null>;

const STEPS = ["sleep", "pem", "symptoms", "activities", "energy"] as const;

export function FormCheckIn({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const theme = useTheme();
  const { t, locale } = useTranslation();
  const reduceMotion = useReduceMotion();
  const deviceId = useDeviceId();
  const submit = useMutation(api.sessions.submitManualCheckIn);

  const [sleepHours, setSleepHours] = useState<number | null>(null);
  const [hadPEM, setHadPEM] = useState<boolean | null>(null);
  const [symptoms, setSymptoms] = useState<Scores>({});
  const [activities, setActivities] = useState<Scores>({});
  const [energy, setEnergy] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const toggle = (set: (fn: (prev: Scores) => Scores) => void, key: string) =>
    set((prev) => {
      const next = { ...prev };
      if (key in next) delete next[key];
      else next[key] = null;
      return next;
    });

  const scoresMissing = (m: Scores) => Object.values(m).some((v) => v === null);
  const stepKey = STEPS[step];
  const isLast = step === STEPS.length - 1;
  // Sleep and crash are optional (skippable); the symptom/activity steps just
  // need every selected chip to have its dots set; the final step needs energy.
  const stepValid =
    stepKey === "symptoms"
      ? !scoresMissing(symptoms)
      : stepKey === "activities"
        ? !scoresMissing(activities)
        : stepKey === "energy"
          ? deviceId != null && energy != null && !submitting
          : true;

  const stepSleep = (delta: number) =>
    setSleepHours((prev) =>
      prev === null
        ? SLEEP_DEFAULT
        : Math.min(SLEEP_MAX, Math.max(0, prev + delta))
    );

  const onSubmit = async () => {
    if (!stepValid || deviceId == null || energy == null) return;
    setSubmitting(true);
    setError(false);
    try {
      await submit({
        deviceId,
        locale,
        sleepHours: sleepHours ?? undefined,
        hadPEMToday: hadPEM ?? undefined,
        energyScore: energy,
        symptoms: Object.entries(symptoms).map(([category, severity]) => ({
          category,
          severity: severity as number,
        })),
        activities: Object.entries(activities).map(([category, exertion]) => ({
          category,
          exertion: exertion as number,
        })),
      });
      onDone();
    } catch {
      setError(true);
      setSubmitting(false);
    }
  };

  // Every step except energy is optional; the primary button reads "Skip"
  // (not "Continue") while the step is untouched, so nobody stalls on a
  // question they can't answer today.
  const stepEmpty =
    (stepKey === "sleep" && sleepHours === null) ||
    (stepKey === "pem" && hadPEM === null) ||
    (stepKey === "symptoms" && Object.keys(symptoms).length === 0) ||
    (stepKey === "activities" && Object.keys(activities).length === 0);

  const enter = reduceMotion ? undefined : FadeIn.duration(180);
  const layout = reduceMotion ? undefined : LinearTransition.duration(180);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Animated.View
          style={styles.flex}
          entering={enter}
          exiting={reduceMotion ? undefined : FadeOut.duration(140)}
        >
          <View style={styles.header}>
            <View style={styles.headerTitle}>
              <ThemedText type="title">{t("form.title")}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {step + 1}/{STEPS.length}
              </ThemedText>
            </View>
            <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={8}>
              <ThemedText type="small" themeColor="textSecondary">
                {t("form.switchToVoice")}
              </ThemedText>
            </Pressable>
          </View>

          <ScrollView
            key={stepKey}
            style={styles.flex}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            <Animated.View entering={enter} style={styles.stepBody}>
            {stepKey === "sleep" ? (
            <Section title={t("form.sleep")} theme={theme}>
              <View style={styles.stepperRow}>
                <StepButton label="−" onPress={() => stepSleep(-SLEEP_STEP)} theme={theme} />
                <View style={[styles.stepperValue, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="title">
                    {sleepHours === null ? "—" : t("today.sleepHours", { value: sleepHours })}
                  </ThemedText>
                </View>
                <StepButton label="+" onPress={() => stepSleep(SLEEP_STEP)} theme={theme} />
              </View>
            </Section>
            ) : null}

            {stepKey === "pem" ? (
            <Section title={t("form.pemQuestion")} hint={t("form.pemHint")} theme={theme}>
              <View style={styles.pillRow}>
                {([true, false] as const).map((value) => {
                  const on = hadPEM === value;
                  return (
                    <Pressable
                      key={String(value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => setHadPEM(on ? null : value)}
                      style={[
                        styles.pill,
                        {
                          backgroundColor: on ? theme.tint : theme.backgroundSelected,
                        },
                      ]}
                    >
                      <ThemedText type="button" style={on ? styles.pillOnText : undefined}>
                        {t(value ? "form.yes" : "form.no")}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>
            </Section>
            ) : null}

            {stepKey === "symptoms" ? (
            <Section title={t("form.symptoms")} hint={t("form.symptomsHint")} theme={theme}>
              {SYMPTOM_CATEGORY_KEYS.map((key) => (
                <CategoryRow
                  key={key}
                  kind="symptom"
                  category={key}
                  label={t(`symptomCategories.${key}`)}
                  scoreLabel={t("common.severity")}
                  score={symptoms[key]}
                  selected={key in symptoms}
                  onToggle={() => toggle(setSymptoms, key)}
                  onScore={(n) => setSymptoms((prev) => ({ ...prev, [key]: n }))}
                  theme={theme}
                  enter={enter}
                  layout={layout}
                  notSetLabel={t("form.notSet")}
                />
              ))}
            </Section>
            ) : null}

            {stepKey === "activities" ? (
            <Section title={t("form.activitiesYesterday")} hint={t("form.activitiesHint")} theme={theme}>
              {ACTIVITY_CATEGORY_KEYS.map((key) => (
                <CategoryRow
                  key={key}
                  kind="activity"
                  category={key}
                  label={t(`activityCategories.${key}`)}
                  scoreLabel={t("common.exertion")}
                  score={activities[key]}
                  selected={key in activities}
                  onToggle={() => toggle(setActivities, key)}
                  onScore={(n) => setActivities((prev) => ({ ...prev, [key]: n }))}
                  theme={theme}
                  enter={enter}
                  layout={layout}
                  notSetLabel={t("form.notSet")}
                />
              ))}
            </Section>
            ) : null}

            {stepKey === "energy" ? (
            <Section title={t("form.energyQuestion")} hint={t("form.energyHint")} theme={theme}>
              <DotRow
                label={t("common.energy")}
                notSetLabel={t("form.notSet")}
                value={energy}
                onChange={setEnergy}
                colored
                theme={theme}
              />
            </Section>
            ) : null}

            {error ? (
              <ThemedText type="small" style={styles.error}>
                {t("voice.error")}
              </ThemedText>
            ) : null}
            </Animated.View>
          </ScrollView>

          <View style={styles.nav}>
            {step > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setStep(step - 1)}
                style={[styles.navButton, { backgroundColor: theme.backgroundElement }]}
              >
                <ThemedText type="button">{t("common.back")}</ThemedText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !stepValid }}
              disabled={!stepValid}
              onPress={() => (isLast ? onSubmit() : setStep(step + 1))}
              style={[
                styles.navButton,
                styles.navPrimary,
                {
                  backgroundColor: stepValid ? theme.tint : theme.backgroundSelected,
                  opacity: stepValid || submitting ? 1 : 0.6,
                },
              ]}
            >
              <ThemedText type="button" style={stepValid ? styles.pillOnText : undefined}>
                {isLast
                  ? submitting
                    ? t("common.loading")
                    : t("form.submit")
                  : t(stepEmpty ? "common.skip" : "common.continue")}
              </ThemedText>
            </Pressable>
          </View>
        </Animated.View>
      </SafeAreaView>
    </ThemedView>
  );
}

function Section({
  title,
  hint,
  theme,
  children,
}: {
  title: string;
  hint?: string;
  theme: { backgroundElement: string };
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.cardLabel}>
        {title.toUpperCase()}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

function StepButton({
  label,
  onPress,
  theme,
}: {
  label: string;
  onPress: () => void;
  theme: { backgroundSelected: string };
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={Spacing.two}
      style={({ pressed }) => [
        styles.stepButton,
        { backgroundColor: theme.backgroundSelected, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <ThemedText type="title">{label}</ThemedText>
    </Pressable>
  );
}

// A category chip; when selected it expands to show the 1–5 dot row.
function CategoryRow({
  kind,
  category,
  label,
  scoreLabel,
  score,
  selected,
  onToggle,
  onScore,
  theme,
  enter,
  layout,
  notSetLabel,
}: {
  kind: "symptom" | "activity";
  category: string;
  label: string;
  scoreLabel: string;
  score: number | null | undefined;
  selected: boolean;
  onToggle: () => void;
  onScore: (n: number) => void;
  theme: { backgroundSelected: string; text: string; backgroundElement: string };
  enter: React.ComponentProps<typeof Animated.View>["entering"];
  layout: React.ComponentProps<typeof Animated.View>["layout"];
  notSetLabel: string;
}) {
  return (
    <Animated.View layout={layout} style={styles.categoryRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={onToggle}
        style={[
          styles.categoryChip,
          { backgroundColor: selected ? theme.backgroundSelected : "transparent" },
        ]}
      >
        <CategoryIcon kind={kind} category={category} />
        <ThemedText style={styles.categoryLabel}>{label}</ThemedText>
      </Pressable>
      {selected ? (
        <Animated.View entering={enter} style={styles.dotIndent}>
          <DotRow
            label={scoreLabel}
            notSetLabel={notSetLabel}
            value={score ?? null}
            onChange={onScore}
            theme={theme}
          />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

// 1–5 dot picker, same visual as SessionEditSheet's severity editor. VoiceOver
// reads it as one adjustable control (swipe up/down to change).
function DotRow({
  label,
  notSetLabel,
  value,
  onChange,
  colored = false,
  theme,
}: {
  label: string;
  notSetLabel: string;
  value: number | null;
  onChange: (n: number) => void;
  colored?: boolean;
  theme: { text: string; backgroundElement: string; backgroundSelected: string };
}) {
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{
        min: 1,
        max: 5,
        now: value ?? 0,
        text: value === null ? notSetLabel : `${value}/5`,
      }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        const current = value ?? 0;
        if (e.nativeEvent.actionName === "increment") onChange(Math.min(5, current + 1));
        else if (current > 1) onChange(current - 1);
      }}
      style={styles.dotRow}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const on = value !== null && n <= value;
        const onColor = colored && value !== null ? ScoreColors[value] : theme.text;
        return (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            hitSlop={8}
            style={[
              styles.dot,
              {
                backgroundColor: on ? onColor : theme.backgroundElement,
                borderColor: theme.backgroundSelected,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.three,
  },
  headerTitle: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.two,
  },
  scroll: {
    paddingBottom: Spacing.three,
  },
  stepBody: {
    gap: Spacing.three,
  },
  nav: {
    flexDirection: "row",
    gap: Spacing.two,
    // The nav sits above the floating tab bar, always reachable without scrolling.
    paddingBottom: BottomTabInset + Spacing.six,
    paddingTop: Spacing.two,
  },
  card: {
    borderRadius: Radius.md,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardLabel: { letterSpacing: 1.2 },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
  },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperValue: {
    minWidth: 120,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
    alignItems: "center",
  },
  pillRow: { flexDirection: "row", gap: Spacing.two },
  pill: {
    flex: 1,
    paddingVertical: Spacing.two + Spacing.one,
    borderRadius: Radius.pill,
    alignItems: "center",
  },
  pillOnText: { color: "#FFFFFF" },
  categoryRow: { gap: Spacing.two },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
    padding: Spacing.two,
    borderRadius: Radius.sm,
  },
  categoryLabel: { flex: 1 },
  dotIndent: { paddingLeft: 38 + Spacing.two, paddingBottom: Spacing.one },
  dotRow: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
  },
  navButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.pill,
    alignItems: "center",
  },
  navPrimary: { flex: 1 },
  error: { color: "#FF3B30", textAlign: "center", marginTop: Spacing.three },
});
