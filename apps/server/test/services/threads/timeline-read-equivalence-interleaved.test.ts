import { INTERLEAVED_EVENT_LOG } from "./timeline-guard-harness.js";
import {
  describeSeedRuns,
  seedRange,
} from "./timeline-read-equivalence-runner.js";

describeSeedRuns(seedRange(17, 8, INTERLEAVED_EVENT_LOG));
