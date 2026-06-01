import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Mark sessions that have been "active" longer than 10 minutes as abandoned.
// Catches: network drops, force-quits, app crashes, lost iPhone, etc.
crons.interval(
  "reap orphan active sessions",
  { minutes: 5 },
  internal.sessions.reapStaleActive,
  {},
);

export default crons;
