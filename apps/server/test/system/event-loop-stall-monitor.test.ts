import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockEventLoopDelayHistogram {
  disable: () => void;
  enable: () => void;
  max: number;
  mean: number;
  percentile: (percentile: number) => number;
  reset: () => void;
}

const perfHooksMock = vi.hoisted(() => {
  const state: { histogram: MockEventLoopDelayHistogram | null } = {
    histogram: null,
  };

  return {
    monitorEventLoopDelay: vi.fn(() => {
      if (state.histogram === null) {
        throw new Error("Expected test histogram to be installed");
      }
      return state.histogram;
    }),
    state,
  };
});

vi.mock("node:perf_hooks", async () => {
  const actual =
    await vi.importActual<typeof import("node:perf_hooks")>("node:perf_hooks");
  return {
    ...actual,
    monitorEventLoopDelay: perfHooksMock.monitorEventLoopDelay,
  };
});

import { performance as nodePerformance } from "node:perf_hooks";
import { startEventLoopStallMonitor } from "../../src/services/system/event-loop-stall-monitor.js";
import {
  resetEventLoopWorkForTests,
  runEventLoopWork,
  runEventLoopWorkSync,
} from "../../src/services/system/event-loop-work.js";

const EVENT_LOOP_STALL_MONITOR_INTERVAL_MS = 5_000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

interface InstallHistogramArgs {
  maxDelayMs: number;
  meanDelayMs: number;
  p99DelayMs: number;
}

function millisecondsToNanoseconds(durationMs: number): number {
  return durationMs * NANOSECONDS_PER_MILLISECOND;
}

function installHistogram(
  args: InstallHistogramArgs,
): MockEventLoopDelayHistogram {
  const histogram = {
    disable: vi.fn(),
    enable: vi.fn(),
    max: millisecondsToNanoseconds(args.maxDelayMs),
    mean: millisecondsToNanoseconds(args.meanDelayMs),
    percentile: vi.fn(() => millisecondsToNanoseconds(args.p99DelayMs)),
    reset: vi.fn(),
  };
  perfHooksMock.state.histogram = histogram;
  return histogram;
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
    vi.useFakeTimers();
    perfHooksMock.monitorEventLoopDelay.mockClear();
    perfHooksMock.state.histogram = null;
    resetEventLoopWorkForTests();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("logs and resets when the max event loop delay reaches the threshold", () => {
    const histogram = installHistogram({
      maxDelayMs: 500,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
    const logger = { info: vi.fn() };

    const monitor = startEventLoopStallMonitor({ logger });
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

    expect(perfHooksMock.monitorEventLoopDelay).toHaveBeenCalledWith({
      resolution: 20,
    });
    expect(histogram.enable).toHaveBeenCalledTimes(1);
    expect(histogram.percentile).toHaveBeenCalledWith(99);
    expect(histogram.reset).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      {
        intervalMs: 5_000,
        maxDelayMs: 500,
        meanDelayMs: 25,
        p99DelayMs: 450,
        resolutionMs: 20,
        thresholdMs: 500,
        ...EMPTY_WORK_SNAPSHOT,
      },
      "Event loop stalled",
    );

    monitor.stop();
  });

  it("does not log below the threshold", () => {
    const histogram = installHistogram({
      maxDelayMs: 499,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
    const logger = { info: vi.fn() };

    const monitor = startEventLoopStallMonitor({ logger });
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

    expect(logger.info).not.toHaveBeenCalled();
    expect(histogram.reset).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it("stops sampling after stop", () => {
    const histogram = installHistogram({
      maxDelayMs: 500,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
    const logger = { info: vi.fn() };

    const monitor = startEventLoopStallMonitor({ logger });
    monitor.stop();
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

    expect(histogram.disable).toHaveBeenCalledTimes(1);
    expect(histogram.reset).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("includes the in-flight unit of work on the stall report", async () => {
    installHistogram({
      maxDelayMs: 500,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
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

    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        currentWork: "GET /api/v1/threads/thr_example/timeline",
        lastWork: null,
        lastWorkMs: null,
        slowestWork: "GET /api/v1/threads/thr_example/timeline",
      }),
      "Event loop stalled",
    );

    release();
    await held;
    monitor.stop();
  });

  it("includes the last finished unit of work on the stall report", () => {
    installHistogram({
      maxDelayMs: 500,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
    const logger = { info: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger });

    runEventLoopWorkSync("sweep:database-maintenance", () => undefined);
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        currentWork: null,
        lastWork: "sweep:database-maintenance",
      }),
      "Event loop stalled",
    );
    const fields = logger.info.mock.calls[0]?.[0] as {
      lastWorkMs: number | null;
    };
    expect(fields.lastWorkMs).toEqual(expect.any(Number));

    monitor.stop();
  });

  it("nests the current work label when units overlap", async () => {
    installHistogram({
      maxDelayMs: 500,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
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

    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

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
    installHistogram({
      maxDelayMs: 500,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
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
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

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

  it("keeps the slowest work from the stall window after later short work", () => {
    installHistogram({
      maxDelayMs: 500,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
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
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

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
