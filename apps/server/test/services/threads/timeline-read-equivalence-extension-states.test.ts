import { EXTENSION_STATE_EVENT_LOG } from "./timeline-guard-harness.js";
import {
  describeSeedRuns,
  seedRange,
} from "./timeline-read-equivalence-runner.js";

describeSeedRuns(seedRange(25, 6, EXTENSION_STATE_EVENT_LOG, true));
