import { SymbolView } from "expo-symbols";
import { StyleSheet, View } from "react-native";

import { categoryIcon } from "@/lib/category-icons";

// Apple Health-style icon tile: a colored rounded square with a white glyph.
// Leads symptom/activity rows so the lists read as Health, not plain text.
export function CategoryIcon({
  kind,
  category,
  size = 30,
}: {
  kind: "symptom" | "activity";
  category: string;
  size?: number;
}) {
  const { symbol, color } = categoryIcon(kind, category);
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size * 0.3, backgroundColor: color },
      ]}
    >
      <SymbolView name={symbol} size={size * 0.58} tintColor="#FFFFFF" weight="semibold" />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
});
