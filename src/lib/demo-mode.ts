import AsyncStorage from "@react-native-async-storage/async-storage";

// Demo-mode flag, set by the Developer screen when a mock scenario is seeded.
// While on, the app must not push real HealthKit reads to Convex (it would
// overwrite the seeded snapshot) and the voice agent is briefed from the
// seeded snapshot instead of the local read. Cleared by "Clear demo data".

const KEY = "mecfs:demoMode";

export async function isDemoMode(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEY)) === "1";
}

export async function setDemoMode(on: boolean): Promise<void> {
  if (on) {
    await AsyncStorage.setItem(KEY, "1");
  } else {
    await AsyncStorage.removeItem(KEY);
  }
}
