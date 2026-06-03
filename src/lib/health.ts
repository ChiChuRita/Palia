import {
  requestAuthorization,
  type CategoryTypeIdentifier,
  type ObjectTypeIdentifier,
  type QuantityTypeIdentifier,
} from "@kingstinct/react-native-healthkit";
import { Platform } from "react-native";
import {
  initialize,
  readRecords,
  requestPermission as requestHealthConnectPermission,
} from "react-native-health-connect";

export type HealthSnapshot = {
  hrvMs: number | null;
  hrvBaselineMs: number | null;
  restingHrBpm: number | null;
  sleepHoursLastNight: number | null;
  stepsYesterday: number | null;
};

const EMPTY: HealthSnapshot = {
  hrvMs: null,
  hrvBaselineMs: null,
  restingHrBpm: null,
  sleepHoursLastNight: null,
  stepsYesterday: null,
};

// --- iOS Setup ---
const READ_QUANTITY_TYPES: readonly QuantityTypeIdentifier[] = [
  "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
  "HKQuantityTypeIdentifierRestingHeartRate",
  "HKQuantityTypeIdentifierStepCount",
];
const READ_CATEGORY_TYPES: readonly CategoryTypeIdentifier[] = [
  "HKCategoryTypeIdentifierSleepAnalysis",
];
const READ_TYPES: readonly ObjectTypeIdentifier[] = [
  ...READ_QUANTITY_TYPES,
  ...READ_CATEGORY_TYPES,
];

export async function requestHealthPermission(): Promise<boolean> {
  if (Platform.OS === "ios") {
    try {
      return await requestAuthorization({ toRead: READ_TYPES });
    } catch {
      return false;
    }
  }

  if (Platform.OS === "android") {
    try {
      const isInitialized = await initialize();
      if (!isInitialized) return false;

      const permissions = await requestHealthConnectPermission([
        { accessType: "read", recordType: "Steps" },
        { accessType: "read", recordType: "RestingHeartRate" },
        { accessType: "read", recordType: "SleepSession" },
        { accessType: "read", recordType: "HeartRateVariabilityRmssd" },
      ]);
      return permissions.length > 0;
    } catch {
      return false;
    }
  }

  return false;
}

export async function readHealthSnapshot(): Promise<HealthSnapshot> {
  const ok = await requestHealthPermission();
  if (!ok) return EMPTY;

  if (Platform.OS === "android") {
    const [hrvMs, restingHrBpm, sleepHoursLastNight, stepsYesterday] = await Promise.all([
      readAndroidHrvLatest(),
      readAndroidRestingHrLatest(),
      readAndroidSleepLastNight(),
      readAndroidStepsYesterday(),
    ]);
    return {
      hrvMs,
      hrvBaselineMs: null,
      restingHrBpm,
      sleepHoursLastNight,
      stepsYesterday,
    };
  }

  if (Platform.OS === "ios") {
    const [hrvMs, hrvBaselineMs, restingHrBpm, sleepHoursLastNight, stepsYesterday] =
      await Promise.all([
        readHrvLatest(),
        readHrvBaseline7Day(),
        readRestingHrLatest(),
        readSleepHoursLastNight(),
        readStepsYesterday(),
      ]);
    return {
      hrvMs,
      hrvBaselineMs,
      restingHrBpm,
      sleepHoursLastNight,
      stepsYesterday,
    };
  }

  return EMPTY;
}

// ─────────────────────────────────────────────────────────────────────────────
// Android Readers — mapping to Health Connect Records
// ─────────────────────────────────────────────────────────────────────────────
const DAY_MS = 24 * 60 * 60 * 1000;

async function readAndroidHrvLatest(): Promise<number | null> {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - DAY_MS);
    const result = await readRecords("HeartRateVariabilityRmssd", {
      timeRangeFilter: {
        operator: "between",
        startTime: yesterday.toISOString(),
        endTime: now.toISOString(),
      },
    });
    const latest = result.records.sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
    )[0];
    return latest ? Math.round(latest.heartRateVariabilityMillis) : null;
  } catch {
    return null;
  }
}

async function readAndroidRestingHrLatest(): Promise<number | null> {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - DAY_MS);
    const result = await readRecords("RestingHeartRate", {
      timeRangeFilter: {
        operator: "between",
        startTime: yesterday.toISOString(),
        endTime: now.toISOString(),
      },
    });
    const latest = result.records.sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()
    )[0];
    return latest ? Math.round(latest.beatsPerMinute) : null;
  } catch {
    return null;
  }
}

async function readAndroidSleepLastNight(): Promise<number | null> {
  try {
    const now = new Date();
    const yesterday6pm = new Date(now);
    yesterday6pm.setDate(now.getDate() - 1);
    yesterday6pm.setHours(18, 0, 0, 0);
    const todayNoon = new Date(now);
    todayNoon.setHours(12, 0, 0, 0);

    const result = await readRecords("SleepSession", {
      timeRangeFilter: {
        operator: "between",
        startTime: yesterday6pm.toISOString(),
        endTime: todayNoon.toISOString(),
      },
    });

    if (result.records.length === 0) return null;
    let totalMs = 0;
    for (const record of result.records) {
      totalMs += new Date(record.endTime).getTime() - new Date(record.startTime).getTime();
    }
    const hours = totalMs / (1000 * 60 * 60);
    return hours > 0.25 ? Math.round(hours * 10) / 10 : null;
  } catch {
    return null;
  }
}

async function readAndroidStepsYesterday(): Promise<number | null> {
  try {
    const now = new Date();
    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(now.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setDate(yesterdayStart.getDate() + 1);

    const result = await readRecords("Steps", {
      timeRangeFilter: {
        operator: "between",
        startTime: yesterdayStart.toISOString(),
        endTime: yesterdayEnd.toISOString(),
      },
    });

    return result.records.reduce((sum, record) => sum + record.count, 0) || null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// iOS Readers (Keep your existing functions below this point)
// ─────────────────────────────────────────────────────────────────────────────
async function readHrvLatest(): Promise<number | null> {
  /* ... your existing code ... */ return null;
}
async function readHrvBaseline7Day(): Promise<number | null> {
  /* ... your existing code ... */ return null;
}
async function readRestingHrLatest(): Promise<number | null> {
  /* ... your existing code ... */ return null;
}
async function readSleepHoursLastNight(): Promise<number | null> {
  /* ... your existing code ... */ return null;
}
async function readStepsYesterday(): Promise<number | null> {
  /* ... your existing code ... */ return null;
}
