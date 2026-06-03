// Inline editor for a symptom / activity / session-score row.
// Severity (or exertion) + delete. No category picker — if the category
// is wrong, delete and let the next check-in capture it correctly.

import { useMutation } from "convex/react";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { useTranslation } from "@/i18n";

import { api } from "@/../convex/_generated/api";
import type { Doc, Id } from "@/../convex/_generated/dataModel";

type Props =
  | {
      kind: "symptom";
      row: Doc<"symptoms">;
      deviceId: string;
      onClose: () => void;
    }
  | {
      kind: "activity";
      row: Doc<"activities">;
      deviceId: string;
      onClose: () => void;
    };

export function SessionEditSheet(props: Props) {
  const theme = useTheme();
  const { t } = useTranslation();
  const editSymptom = useMutation(api.sessions.editSymptom);
  const deleteSymptom = useMutation(api.sessions.deleteSymptom);
  const editActivity = useMutation(api.sessions.editActivity);
  const deleteActivity = useMutation(api.sessions.deleteActivity);

  const initialScore = props.kind === "symptom" ? props.row.severity : props.row.exertion;
  const [score, setScore] = useState<number | null>(initialScore ?? null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const scoreLabel = props.kind === "symptom" ? t("common.severity") : t("common.exertion");

  const onSave = async () => {
    if (score === initialScore) {
      props.onClose();
      return;
    }
    if (props.kind === "symptom") {
      await editSymptom({
        symptomId: props.row._id as Id<"symptoms">,
        deviceId: props.deviceId,
        severity: score ?? undefined,
      });
    } else {
      await editActivity({
        activityId: props.row._id as Id<"activities">,
        deviceId: props.deviceId,
        exertion: score ?? undefined,
      });
    }
    props.onClose();
  };

  const onDelete = async () => {
    if (props.kind === "symptom") {
      await deleteSymptom({
        symptomId: props.row._id as Id<"symptoms">,
        deviceId: props.deviceId,
      });
    } else {
      await deleteActivity({
        activityId: props.row._id as Id<"activities">,
        deviceId: props.deviceId,
      });
    }
    props.onClose();
  };

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      style={[
        styles.sheet,
        { backgroundColor: theme.background, borderColor: theme.backgroundSelected },
      ]}
    >
      <View style={styles.field}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
          {scoreLabel.toUpperCase()}
        </ThemedText>
        <View style={styles.scoreRow}>
          {[1, 2, 3, 4, 5].map((n) => {
            const on = score != null && n <= score;
            return (
              <Pressable
                key={n}
                onPress={() => setScore(n === score ? null : n)}
                hitSlop={8}
                style={[
                  styles.scoreDot,
                  {
                    backgroundColor: on ? theme.text : theme.backgroundElement,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>

      <View style={styles.actions}>
        {confirmingDelete ? (
          <>
            <ThemedText type="small" themeColor="textSecondary" style={styles.confirmText}>
              {t("common.deleteConfirm")}
            </ThemedText>
            <Pressable
              onPress={() => setConfirmingDelete(false)}
              style={[styles.action, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText type="small">{t("common.cancel")}</ThemedText>
            </Pressable>
            <Pressable onPress={onDelete} style={[styles.action, styles.dangerAction]}>
              <ThemedText type="small" style={styles.dangerText}>
                {t("common.delete")}
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => setConfirmingDelete(true)}
              style={[styles.action, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText type="small">{t("common.delete")}</ThemedText>
            </Pressable>
            <Pressable
              onPress={props.onClose}
              style={[styles.action, { backgroundColor: theme.backgroundElement }]}
            >
              <ThemedText type="small">{t("common.cancel")}</ThemedText>
            </Pressable>
            <Pressable
              onPress={onSave}
              style={[styles.action, { backgroundColor: theme.backgroundSelected }]}
            >
              <ThemedText type="small">{t("common.save")}</ThemedText>
            </Pressable>
          </>
        )}
      </View>
    </Animated.View>
  );
}

// Small editor for the session's energy score itself.
export function EnergyScoreEditor({
  session,
  deviceId,
  onClose,
}: {
  session: Doc<"sessions">;
  deviceId: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const editScore = useMutation(api.sessions.editSessionScore);
  const [score, setScore] = useState<number>(session.energyScore ?? 3);

  const save = async () => {
    await editScore({
      sessionId: session._id as Id<"sessions">,
      deviceId,
      energyScore: score,
    });
    onClose();
  };

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      style={[
        styles.sheet,
        { backgroundColor: theme.background, borderColor: theme.backgroundSelected },
      ]}
    >
      <View style={styles.field}>
        <ThemedText type="smallBold" themeColor="textSecondary" style={styles.label}>
          {t("common.energy").toUpperCase()}
        </ThemedText>
        <View style={styles.scoreRow}>
          {[1, 2, 3, 4, 5].map((n) => {
            const on = n <= score;
            return (
              <Pressable
                key={n}
                onPress={() => setScore(n)}
                hitSlop={8}
                style={[
                  styles.scoreDot,
                  {
                    backgroundColor: on ? theme.text : theme.backgroundElement,
                    borderColor: theme.backgroundSelected,
                  },
                ]}
              />
            );
          })}
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={onClose}
          style={[styles.action, { backgroundColor: theme.backgroundElement }]}
        >
          <ThemedText type="small">{t("common.cancel")}</ThemedText>
        </Pressable>
        <Pressable
          onPress={save}
          style={[styles.action, { backgroundColor: theme.backgroundSelected }]}
        >
          <ThemedText type="small">{t("common.save")}</ThemedText>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
  },
  field: { gap: Spacing.two },
  label: { letterSpacing: 1.2 },
  scoreRow: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
  },
  scoreDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.two,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  action: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  dangerAction: { backgroundColor: "#b85a5a" },
  dangerText: { color: "white" },
  confirmText: { flex: 1 },
});
