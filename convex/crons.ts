import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Fixes the stored state of runs that died without failing: see
// analyses.failStale. It runs more often than the staleness limit so an
// abandoned run is marked within a couple of minutes of crossing it.
const crons = cronJobs();

crons.interval("fail stale analyses", { minutes: 2 }, internal.analyses.failStale);

export default crons;
