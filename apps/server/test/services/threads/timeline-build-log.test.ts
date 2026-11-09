import { describe, expect, it, vi } from "vitest";
import { createSlowThreadTimelineBuildLogger } from "../../../src/services/threads/timeline-build-log.js";
import type { ThreadTimelineBuildProfile } from "../../../src/services/threads/timeline.js";

const SLOW_PROFILE: ThreadTimelineBuildProfile = {
  compactedEventCount: 0,
  decodedEventCount: 7_496,
  eventDataBytes: 11_500_000,
  eventRowCount: 7_496,
  foldedEventCount: 0,
  pageKind: "latest",
  projectedRowCount: 433,
  responseRowCount: 433,
  returnedSegmentCount: 1,
  segmentLimit: 20,
  selectionStrategy: "standard-window",
  stageTimings: [{ durationMs: 663.5, stage: "event-json-decode" }],
  totalDurationMs: 663.5,
};

describe("slow thread timeline build log", () => {
  it("separates main-thread CPU and context switches from wall time", () => {
    const logger = { info: vi.fn() };

    createSlowThreadTimelineBuildLogger({ logger }).log({
      cost: {
        cpuMs: 263.44,
        involuntaryContextSwitches: 1_204,
        voluntaryContextSwitches: 3,
        wallMs: 670.8,
      },
      profile: SLOW_PROFILE,
      threadId: "thr_example",
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 663.5,
        cpuDurationMs: 263.4,
        involuntaryContextSwitches: 1_204,
        voluntaryContextSwitches: 3,
      }),
      "Thread timeline build blocked the event loop",
    );
  });
});
