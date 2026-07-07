import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Mark sessions that have been "active" longer than 10 minutes as abandoned.
// Catches: network drops, force-quits, app crashes, lost iPhone, etc.
crons.interval(
  "reap orphan active sessions",
  { minutes: 5 },
  internal.sessions.reapStaleActive,
  {}
);

// Stage-2 analyst: once a day, generate the energy-envelope insight for every
// recently-active device. The manual "Analyze now" button covers same-day demos.
// Known tension: 06:00 UTC (08:00 DE) can predate the watch's overnight sync,
// so this run may see yesterday-shaped wearables. Acceptable because every
// completed check-in re-runs the analysis with fresh data, and dailyAnalyze
// skips devices whose insight is already ready and newer than their data
// (insights.hasFreshInsight) — the cron never clobbers a fresher same-day read.
crons.daily(
  "daily insight analysis",
  { hourUTC: 6, minuteUTC: 0 },
  internal.insights.dailyAnalyze,
  {}
);

export default crons;
