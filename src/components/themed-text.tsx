import { Platform, StyleSheet, Text, type TextProps } from "react-native";

import { Fonts, ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

export type ThemedTextProps = TextProps & {
  type?:
    | "default"
    | "button"
    | "title"
    | "small"
    | "smallBold"
    | "heading"
    | "link"
    | "linkPrimary"
    | "code";
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = "default", themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? "text"] },
        type === "default" && styles.default,
        type === "button" && styles.button,
        type === "title" && styles.title,
        type === "small" && styles.small,
        type === "smallBold" && styles.smallBold,
        type === "heading" && styles.heading,
        type === "link" && styles.link,
        type === "linkPrimary" && styles.linkPrimary,
        type === "code" && styles.code,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  button: {
    // Body-sized semibold — the one style for text inside buttons/pills.
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 600,
  },
  title: {
    // Screen headers & heroes — Health-style bold large title
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 700,
  },
  heading: {
    // Health section headers ("Favorites") — bold, sentence case
    fontSize: 20,
    lineHeight: 25,
    fontWeight: 700,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
    fontWeight: 500,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: "#007AFF",
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 14,
  },
});
