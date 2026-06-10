import {
  CategoryValueSleepAnalysis,
  getMostRecentQuantitySample,
  queryCategorySamples,
  queryQuantitySamples,
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
  // Steps so far today (live, grows through the day) — for the Today chip.
  stepsToday: number | null;
  // Steps for the previous complete calendar day — the analyst's load signal.
  stepsYesterday: number | null;
};

const EMPTY: HealthSnapshot = {
  hrvMs: null,
  hrvBaselineMs: null,
  restingHrBpm: null,
  sleepHoursLastNight: null,
  stepsToday: null,
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
    const [hrvMs, restingHrBpm, sleepHoursLastNight, stepsToday, stepsYesterday] =
      await Promise.all([
        readAndroidHrvLatest(),
        readAndroidRestingHrLatest(),
        readAndroidSleepLastNight(),
        readAndroidStepsToday(),
        readAndroidStepsYesterday(),
      ]);
    return {
      hrvMs,
      hrvBaselineMs: null,
      restingHrBpm,
      sleepHoursLastNight,
      stepsToday,
      stepsYesterday,
    };
  }

  if (Platform.OS === "ios") {
    const [hrvMs, hrvBaselineMs, restingHrBpm, sleepHoursLastNight, stepsToday, stepsYesterday] =
      await Promise.all([
        readHrvLatest(),
        readHrvBaseline7Day(),
        readRestingHrLatest(),
        readSleepHoursLastNight(),
        readStepsToday(),
        readStepsYesterday(),
      ]);
    return {
      hrvMs,
      hrvBaselineMs,
      restingHrBpm,
      sleepHoursLastNight,
      stepsToday,
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

async function readAndroidStepsToday(): Promise<number | null> {
  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const result = await readRecords("Steps", {
      timeRangeFilter: {
        operator: "between",
        startTime: todayStart.toISOString(),
        endTime: now.toISOString(),
      },
    });

    return result.records.reduce((sum, record) => sum + record.count, 0) || null;
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
// iOS Readers — Apple HealthKit via @kingstinct/react-native-healthkit
// ─────────────────────────────────────────────────────────────────────────────

// Latest overnight HRV (SDNN), in milliseconds.
async function readHrvLatest(): Promise<number | null> {
  try {
    const sample = await getMostRecentQuantitySample(
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      "ms"
    );
    return sample ? Math.round(sample.quantity) : null;
  } catch {
    return null;
  }
}

// 7-day rolling average of HRV (SDNN), in milliseconds. The agent + analyst use
// this as the personal baseline to detect autonomic strain (HRV ↓ vs baseline).
async function readHrvBaseline7Day(): Promise<number | null> {
  try {
    const samples = await queryQuantitySamples(
      "HKQuantityTypeIdentifierHeartRateVariabilitySDNN",
      {
        unit: "ms",
        filter: { date: { startDate: new Date(Date.now() - 7 * DAY_MS), endDate: new Date() } },
        limit: 0, // all samples in range
      }
    );
    if (samples.length === 0) return null;
    const avg = samples.reduce((sum, s) => sum + s.quantity, 0) / samples.length;
    return Math.round(avg);
  } catch {
    return null;
  }
}

// Latest resting heart rate, in beats per minute.
async function readRestingHrLatest(): Promise<number | null> {
  try {
    const sample = await getMostRecentQuantitySample(
      "HKQuantityTypeIdentifierRestingHeartRate",
      "count/min"
    );
    return sample ? Math.round(sample.quantity) : null;
  } catch {
    return null;
  }
}

// Hours actually asleep last night (excludes in-bed-but-awake), summed across
// sleep samples in the yesterday-6pm → today-noon window.
async function readSleepHoursLastNight(): Promise<number | null> {
  try {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - 1);
    start.setHours(18, 0, 0, 0);
    const end = new Date(now);
    end.setHours(12, 0, 0, 0);

    const samples = await queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
      filter: { date: { startDate: start, endDate: end } },
      limit: 0,
    });

    const ASLEEP = new Set<number>([
      CategoryValueSleepAnalysis.asleep, // == asleepUnspecified (1)
      CategoryValueSleepAnalysis.asleepCore,
      CategoryValueSleepAnalysis.asleepDeep,
      CategoryValueSleepAnalysis.asleepREM,
    ]);

    let totalMs = 0;
    for (const s of samples) {
      if (!ASLEEP.has(s.value as number)) continue;
      totalMs += s.endDate.getTime() - s.startDate.getTime();
    }
    const hours = totalMs / (1000 * 60 * 60);
    return hours > 0.25 ? Math.round(hours * 10) / 10 : null;
  } catch {
    return null;
  }
}

// Step count so far for the current local day (midnight → now). Grows through
// the day, so it reflects what the user has actually walked when they look.
async function readStepsToday(): Promise<number | null> {
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();

    const samples = await queryQuantitySamples("HKQuantityTypeIdentifierStepCount", {
      unit: "count",
      filter: { date: { startDate: start, endDate: end } },
      limit: 0,
    });
    const total = samples.reduce((sum, s) => sum + s.quantity, 0);
    return total > 0 ? Math.round(total) : null;
  } catch {
    return null;
  }
}

// Total step count for the previous local calendar day.
async function readStepsYesterday(): Promise<number | null> {
  try {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);

    const samples = await queryQuantitySamples("HKQuantityTypeIdentifierStepCount", {
      unit: "count",
      filter: { date: { startDate: start, endDate: end } },
      limit: 0,
    });
    const total = samples.reduce((sum, s) => sum + s.quantity, 0);
    return total > 0 ? Math.round(total) : null;
  } catch {
    return null;
  }
}
