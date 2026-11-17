import { MIXED_EVENT_LOG } from "./timeline-guard-harness.js";
import {
  describeSeedRuns,
  seedRange,
} from "./timeline-read-equivalence-runner.js";

describeSeedRuns(seedRange(9, 8, MIXED_EVENT_LOG));
