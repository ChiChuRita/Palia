import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InsightCard } from "@/components/insight-card";
import { Trends } from "@/components/trends";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, Spacing } from "@/constants/theme";
import { useTranslation } from "@/i18n";

export default function InsightsScreen() {
  const { t } = useTranslation();
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <ThemedText type="title">{t("insights.tab")}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t("insights.subtitle")}
            </ThemedText>
          </View>
          <InsightCard />
          <Trends />
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  header: { gap: Spacing.one },
});
