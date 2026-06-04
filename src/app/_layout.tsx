import { ConvexProvider } from "convex/react";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import AppTabs from "@/components/app-tabs";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { initLocale } from "@/i18n";
import { convex } from "@/lib/convex";
import { useOnboardingState } from "@/lib/onboarding";

if (Platform.OS !== "web") {
  import("@livekit/react-native").then(({ registerGlobals }) => registerGlobals());
}

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [localeReady, setLocaleReady] = useState(false);
  const { onboarded, setOnboarded, ready: onboardingReady } = useOnboardingState();

  useEffect(() => {
    initLocale().then(() => setLocaleReady(true));
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") {
      document.title = "Palia";
    }
  });

  const ready = localeReady && onboardingReady;

  return (
    <ConvexProvider client={convex}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {!ready ? null : !onboarded ? (
          <OnboardingFlow onDone={() => setOnboarded(true)} />
        ) : (
          <AppTabs />
        )}
      </ThemeProvider>
    </ConvexProvider>
  );
}
