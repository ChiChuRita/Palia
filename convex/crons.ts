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
crons.daily(
  "daily insight analysis",
  { hourUTC: 6, minuteUTC: 0 },
  internal.insights.dailyAnalyze,
  {}
);

export default crons;
