import { afterAll, beforeAll } from "vitest";
import { setTimelineProjectionFreezeForTesting } from "../../src/services/threads/timeline-projection.js";

beforeAll(() => {
  setTimelineProjectionFreezeForTesting(true);
});

afterAll(() => {
  setTimelineProjectionFreezeForTesting(false);
});
