import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { performance as nodePerformance } from "node:perf_hooks";
import { startEventLoopStallMonitor } from "../../src/services/system/event-loop-stall-monitor.js";
import {
  resetEventLoopWorkForTests,
  runEventLoopWork,
  runEventLoopWorkSync,
} from "../../src/services/system/event-loop-work.js";

const EVENT_LOOP_STALL_MONITOR_INTERVAL_MS = 5_000;
const realSetTimeout = setTimeout;
const realSetInterval = setInterval;
const TEST_MONITOR_INTERVAL_MS = 700;

function blockEventLoopFor(durationMs: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
}

function waitForEventLoopSample(): Promise<void> {
  return new Promise((resolve) =>
    realSetTimeout(resolve, TEST_MONITOR_INTERVAL_MS + 50),
  );
}

function waitForHistogramBaseline(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 50));
}

const EMPTY_WORK_SNAPSHOT = {
  currentWork: null,
  lastWork: null,
  lastWorkMs: null,
  slowestWork: null,
  slowestWorkMs: null,
};

describe("event loop stall monitor", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "setInterval").mockImplementation(
      (handler, _timeout, ...args) =>
        realSetInterval(handler, TEST_MONITOR_INTERVAL_MS, ...args),
    );
    resetEventLoopWorkForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs and resets when the max event loop delay reaches the threshold", async () => {
    const logger = { info: vi.fn() };

    const monitor = startEventLoopStallMonitor({ logger });
    await waitForHistogramBaseline();
    blockEventLoopFor(600);
    await waitForEventLoopSample();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: EVENT_LOOP_STALL_MONITOR_INTERVAL_MS,
        resolutionMs: 20,
        thresholdMs: 500,
        ...EMPTY_WORK_SNAPSHOT,
      }),
      "Event loop stalled",
    );

    monitor.stop();
  });

  it("does not log below the threshold", async () => {
    const logger = { info: vi.fn() };

    const monitor = startEventLoopStallMonitor({ logger });
    await waitForEventLoopSample();

    expect(logger.info).not.toHaveBeenCalled();

    monitor.stop();
  });

  it("suppresses histogram delays accumulated while the system was suspended", async () => {
    const logger = { info: vi.fn() };
    let now = 0;

    const monitor = startEventLoopStallMonitor({ logger, now: () => now });
    await waitForHistogramBaseline();
    blockEventLoopFor(600);
    now = 300_000;
    await waitForEventLoopSample();

    expect(logger.info).not.toHaveBeenCalled();

    monitor.stop();
  });

  it("stops sampling after stop", async () => {
    const logger = { info: vi.fn() };

    const monitor = startEventLoopStallMonitor({ logger });
    monitor.stop();
    await waitForEventLoopSample();

    expect(logger.info).not.toHaveBeenCalled();
  });

  it("does not attribute an in-flight async wait as the event loop block", async () => {
    const logger = { info: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger });
    let release!: () => void;
    const held = runEventLoopWork(
      "GET /api/v1/threads/thr_example/timeline",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    await waitForHistogramBaseline();
    blockEventLoopFor(600);
    await waitForEventLoopSample();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        currentWork: "GET /api/v1/threads/thr_example/timeline",
        lastWork: null,
        lastWorkMs: null,
        slowestWork: null,
        slowestWorkMs: null,
      }),
      "Event loop stalled",
    );

    release();
    await held;
    monitor.stop();
  });

  it("includes the last finished unit of work on the stall report", async () => {
    const logger = { info: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger });

    runEventLoopWorkSync("sweep:database-maintenance", () => undefined);
    await waitForHistogramBaseline();
    blockEventLoopFor(600);
    await waitForEventLoopSample();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        currentWork: null,
        lastWork: "sweep:database-maintenance",
      }),
      "Event loop stalled",
    );
    // SAFETY: The monitor always logs an object with the lastWorkMs field.
    const fields = logger.info.mock.calls[0]?.[0] as {
      lastWorkMs: number | null;
    };
    expect(fields.lastWorkMs).toEqual(expect.any(Number));

    monitor.stop();
  });

  it("nests the current work label when units overlap", async () => {
    const logger = { info: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger });
    let release!: () => void;
    const held = runEventLoopWork(
      "GET /api/v1/threads/thr_example/timeline",
      () =>
        runEventLoopWork(
          "timeline-build thr_example",
          () =>
            new Promise<void>((resolve) => {
              release = resolve;
            }),
        ),
    );

    await waitForHistogramBaseline();
    blockEventLoopFor(600);
    await waitForEventLoopSample();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        currentWork:
          "GET /api/v1/threads/thr_example/timeline > timeline-build thr_example",
      }),
      "Event loop stalled",
    );

    release();
    await held;
    monitor.stop();
  });

  it("keeps sibling frames when one request finishes first", async () => {
    const logger = { info: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger });
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = runEventLoopWork(
      "GET /api/v1/first",
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = runEventLoopWork(
      "GET /api/v1/second",
      () =>
        new Promise<void>((resolve) => {
          releaseSecond = resolve;
        }),
    );

    releaseFirst();
    await first;
    await waitForHistogramBaseline();
    blockEventLoopFor(600);
    await waitForEventLoopSample();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        currentWork: "GET /api/v1/second",
        lastWork: "GET /api/v1/first",
      }),
      "Event loop stalled",
    );

    releaseSecond();
    await second;
    monitor.stop();
  });

  it("keeps the slowest work from the stall window after later short work", async () => {
    const logger = { info: vi.fn() };
    const nowSpy = vi.spyOn(nodePerformance, "now");
    nowSpy.mockReturnValueOnce(0);
    nowSpy.mockReturnValueOnce(650);
    runEventLoopWorkSync("sweep:database-maintenance", () => undefined);
    nowSpy.mockReturnValueOnce(650);
    nowSpy.mockReturnValueOnce(651);
    runEventLoopWorkSync("ws:daemon heartbeat", () => undefined);
    nowSpy.mockRestore();

    const monitor = startEventLoopStallMonitor({ logger });
    await waitForHistogramBaseline();
    blockEventLoopFor(600);
    await waitForEventLoopSample();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        lastWork: "ws:daemon heartbeat",
        lastWorkMs: 1,
        slowestWork: "sweep:database-maintenance",
        slowestWorkMs: 650,
      }),
      "Event loop stalled",
    );

    monitor.stop();
  });
});
