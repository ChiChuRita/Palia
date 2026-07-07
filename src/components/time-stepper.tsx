// A compact −/time/+ control for picking the daily reminder time without a
// native date-picker dependency. Steps by 15 minutes, wrapping around the day.

import { Pressable, StyleSheet, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Radius, Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { formatTime, stepTime } from "@/lib/reminders";

const STEP_MIN = 15;

export function TimeStepper({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) {
  const theme = useTheme();
  const shift = (delta: number) => {
    const next = stepTime(hour, minute, delta);
    onChange(next.hour, next.minute);
  };
  return (
    <View style={styles.row}>
      <StepButton label="−" onPress={() => shift(-STEP_MIN)} theme={theme} />
      <View style={[styles.value, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="title">{formatTime(hour, minute)}</ThemedText>
      </View>
      <StepButton label="+" onPress={() => shift(STEP_MIN)} theme={theme} />
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
  theme: { backgroundElement: string };
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={Spacing.two}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <ThemedText type="title">{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
    justifyContent: "center",
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  value: {
    minWidth: 120,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.md,
    alignItems: "center",
  },
});
