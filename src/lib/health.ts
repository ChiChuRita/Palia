// HealthKit reader — iOS only. Uses @kingstinct/react-native-healthkit
// (Nitro-modules-based, designed for RN 0.85+ / New Architecture).
//
// Two exported functions:
//   - requestHealthPermission(): triggers the iOS Health permission sheet on
//     first call; no-op on subsequent calls (iOS won't re-show). Returns
//     `true` if at least one type was granted; `false` if user denied,
//     non-iOS, or any error.
//   - readHealthSnapshot(): returns the Tier 1 fields with null for any
//     value we couldn't read. Never throws. Always returns the same shape.
//     Implicitly requests permission if not yet granted.
//
// We deliberately do NOT cache permission state in memory: kingstinct/iOS
// already handle the "don't re-prompt" logic, and an in-process flag would
// just drift out of sync if the user revokes via Settings.
//
// See HEALTHKIT.md for the full mapping of identifiers to ME/CFS biomarkers.

import { Platform } from 'react-native';
import {
  CategoryValueSleepAnalysis,
  getMostRecentQuantitySample,
  queryCategorySamples,
  queryStatisticsForQuantity,
  requestAuthorization,
  type CategoryTypeIdentifier,
  type ObjectTypeIdentifier,
  type QuantityTypeIdentifier,
} from '@kingstinct/react-native-healthkit';

export type HealthSnapshot = {
  hrvMs: number | null; // heart rate variability SDNN, latest sample (ms)
  hrvBaselineMs: number | null; // rolling avg, last 7 days EXCLUDING last 24h
  restingHrBpm: number | null; // latest resting heart rate
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

// Typed identifier lists — kingstinct's `requestAuthorization` accepts
// `readonly ObjectTypeIdentifier[]` which is a union of Quantity + Category +
// other sample types. Concatenating two well-typed arrays gives us a clean
// `readonly ObjectTypeIdentifier[]` with zero `as` casts.
const READ_QUANTITY_TYPES: readonly QuantityTypeIdentifier[] = [
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKQuantityTypeIdentifierRestingHeartRate',
  'HKQuantityTypeIdentifierStepCount',
];
const READ_CATEGORY_TYPES: readonly CategoryTypeIdentifier[] = [
  'HKCategoryTypeIdentifierSleepAnalysis',
];
const READ_TYPES: readonly ObjectTypeIdentifier[] = [
  ...READ_QUANTITY_TYPES,
  ...READ_CATEGORY_TYPES,
];

export async function requestHealthPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    // kingstinct returns true if init + grant succeeded for at least one
    // requested type. iOS deliberately doesn't tell us per-type denial.
    return await requestAuthorization({ toRead: READ_TYPES });
  } catch {
    return false;
  }
}

export async function readHealthSnapshot(): Promise<HealthSnapshot> {
  if (Platform.OS !== 'ios') return EMPTY;
  const ok = await requestHealthPermission();
  if (!ok) return EMPTY;

  // Parallel reads — each helper returns null on any failure, never throws.
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-field readers — defensive: catch all errors, return null on miss.
// HealthKit stores HRV SDNN in seconds; we multiply by 1000 for ms.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

async function readHrvLatest(): Promise<number | null> {
  try {
    const sample = await getMostRecentQuantitySample(
      'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
    );
    if (!sample || typeof sample.quantity !== 'number') return null;
    return Math.round(sample.quantity * 1000);
  } catch {
    return null;
  }
}

async function readHrvBaseline7Day(): Promise<number | null> {
  // Window: [now - 7d, now - 24h]. Excluding the last 24h is intentional —
  // we want "what does HRV usually look like" so that a bad day stands out
  // when compared against this baseline. Including today would dampen the
  // signal we want the agent to surface.
  try {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * DAY_MS);
    const yesterday = new Date(now - DAY_MS);
    const result = await queryStatisticsForQuantity(
      'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
      ['discreteAverage'],
      { filter: { date: { startDate: sevenDaysAgo, endDate: yesterday } } },
    );
    const avg = result.averageQuantity?.quantity;
    return typeof avg === 'number' && avg > 0 ? Math.round(avg * 1000) : null;
  } catch {
    return null;
  }
}

async function readRestingHrLatest(): Promise<number | null> {
  try {
    const sample = await getMostRecentQuantitySample(
      'HKQuantityTypeIdentifierRestingHeartRate',
    );
    if (!sample || typeof sample.quantity !== 'number') return null;
    return Math.round(sample.quantity);
  } catch {
    return null;
  }
}

async function readSleepHoursLastNight(): Promise<number | null> {
  // "Last night" = yesterday 6pm to today noon — wide enough to catch both
  // early sleepers and late risers, narrow enough not to pick up two nights.
  //
  // HealthKit may emit OVERLAPPING samples for the same period: an umbrella
  // `asleep` sample from one source plus per-stage `asleepCore/Deep/REM`
  // samples from another. Summing all durations would double-count. Instead,
  // we use the bounding-box approach:
  //   total sleep = (max(asleep endDate) - min(asleep startDate)) - awake within
  // This collapses overlaps naturally and is the same approach used by most
  // sleep apps. It can slightly over-estimate when two sources disagree at
  // the edges, but that's acceptable vs the 2x error of naive summing.
  try {
    const now = new Date();
    const yesterday6pm = new Date(now);
    yesterday6pm.setDate(now.getDate() - 1);
    yesterday6pm.setHours(18, 0, 0, 0);
    const todayNoon = new Date(now);
    todayNoon.setHours(12, 0, 0, 0);
    const samples = await queryCategorySamples(
      'HKCategoryTypeIdentifierSleepAnalysis',
      {
        filter: { date: { startDate: yesterday6pm, endDate: todayNoon } },
        limit: 200,
        ascending: true,
      },
    );

    let earliestAsleep = Infinity;
    let latestAsleep = -Infinity;
    let awakeMs = 0;

    for (const s of samples) {
      const start = s.startDate?.getTime?.();
      const end = s.endDate?.getTime?.();
      if (
        typeof start !== 'number' ||
        typeof end !== 'number' ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start
      ) {
        continue;
      }

      if (s.value === CategoryValueSleepAnalysis.inBed) {
        // "in bed" without being asleep — ignore entirely.
        continue;
      }
      if (s.value === CategoryValueSleepAnalysis.awake) {
        awakeMs += end - start;
        continue;
      }
      // Anything else is some flavor of asleep (Unspecified, Core, Deep, REM).
      if (start < earliestAsleep) earliestAsleep = start;
      if (end > latestAsleep) latestAsleep = end;
    }

    if (earliestAsleep === Infinity) return null;
    const totalMs = latestAsleep - earliestAsleep - awakeMs;
    const hours = totalMs / (1000 * 60 * 60);
    return hours > 0.25 ? Math.round(hours * 10) / 10 : null;
  } catch {
    return null;
  }
}

async function readStepsYesterday(): Promise<number | null> {
  try {
    const now = new Date();
    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(now.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(yesterdayStart);
    yesterdayEnd.setDate(yesterdayStart.getDate() + 1);
    const result = await queryStatisticsForQuantity(
      'HKQuantityTypeIdentifierStepCount',
      ['cumulativeSum'],
      {
        filter: {
          date: { startDate: yesterdayStart, endDate: yesterdayEnd },
        },
      },
    );
    const total = result.sumQuantity?.quantity;
    return typeof total === 'number' && total >= 0 ? Math.round(total) : null;
  } catch {
    return null;
  }
}
