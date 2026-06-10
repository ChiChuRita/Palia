import { ConvexProvider } from "convex/react";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { useEffect, useState } from "react";
import { LogBox, Platform, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import AppTabs from "@/components/app-tabs";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { initLocale } from "@/i18n";
import { convex } from "@/lib/convex";
import { useOnboardingState } from "@/lib/onboarding";
import { initReminders } from "@/lib/reminders";

if (Platform.OS !== "web") {
  import("@livekit/react-native").then(({ registerGlobals }) => registerGlobals());
}

// livekit-client races an in-flight WebRTC renegotiation against its own
// teardown when a call ends; the rejection ("NegotiationError: PC manager is
// closed") fires after the session is already finalized, so it's harmless —
// but it surfaces as a dev-only LogBox overlay. Keep it out of the demo.
LogBox.ignoreLogs([/NegotiationError/, /PC manager is closed/]);

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const [localeReady, setLocaleReady] = useState(false);
  const { onboarded, setOnboarded, ready: onboardingReady } = useOnboardingState();

  useEffect(() => {
    // initReminders() runs after initLocale() so the notification copy + Android
    // channel name use the resolved language. It re-asserts any saved schedule.
    initLocale()
      .then(() => initReminders())
      .catch(() => {})
      .finally(() => setLocaleReady(true));
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
