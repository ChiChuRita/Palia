export type HealthSnapshot = {
  hrvMs: number | null;
  hrvBaselineMs: number | null;
  restingHrBpm: number | null;
  sleepHoursLastNight: number | null;
  // True when the sleep samples genuinely ended last night; absent when sleep
  // data is absent. Mirrors ./health.ts.
  sleepIsLastNight?: boolean;
  stepsToday: number | null;
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

export async function requestHealthPermission(): Promise<boolean> {
  // Health APIs are not available on web
  return false;
}

export async function readHealthSnapshot(): Promise<HealthSnapshot> {
  // Health APIs are not available on web
  return EMPTY;
}
