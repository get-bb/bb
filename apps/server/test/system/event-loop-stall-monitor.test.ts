import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { console as inspectorConsole } from "node:inspector";
import { createConnection, migrate, setExperiments } from "@bb/db";
import { startGatedPerformanceDiagnostics } from "../../src/services/system/performance-diagnostics.js";
import { NotificationHub } from "../../src/ws/hub.js";

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
  inFlightWorkAtObservation: null,
  lastCompletedWork: null,
  lastCompletedWorkWallMs: null,
  longestSynchronousWork: null,
  longestSynchronousWorkWallMs: null,
  longestSynchronousWorkCpuMs: null,
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

  it.each([undefined, 100])(
    "logs and resets at the configured threshold %s",
    (thresholdMs) => {
      const expectedThreshold = thresholdMs ?? 500;
      const histogram = installHistogram({
        maxDelayMs: expectedThreshold,
        meanDelayMs: 25,
        p99DelayMs: 450,
      });
      const logger = { info: vi.fn() };

      const monitor = startEventLoopStallMonitor({ logger, thresholdMs });
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
          maxDelayMs: expectedThreshold,
          meanDelayMs: 25,
          p99DelayMs: 450,
          resolutionMs: 20,
          thresholdMs: expectedThreshold,
          stallAttribution: "unattributed",
          stallCauseCandidate: null,
          ...EMPTY_WORK_SNAPSHOT,
        },
        "Event loop stalled",
      );

      monitor.stop();
    },
  );

  it("restores the normal threshold without restarting the sampler", () => {
    installHistogram({ maxDelayMs: 150, meanDelayMs: 25, p99DelayMs: 100 });
    const logger = { info: vi.fn() };
    let enabled = true;
    const monitor = startEventLoopStallMonitor({
      logger,
      thresholdMs: () => (enabled ? 100 : 500),
    });
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);
    expect(logger.info).toHaveBeenCalledTimes(1);
    enabled = false;
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);
    expect(logger.info).toHaveBeenCalledTimes(1);
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

  it("does not attribute an in-flight async wait as the event loop block", async () => {
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
        inFlightWorkAtObservation: "GET /api/v1/threads/thr_example/timeline",
        lastCompletedWork: null,
        lastCompletedWorkWallMs: null,
        longestSynchronousWork: null,
        longestSynchronousWorkWallMs: null,
        stallAttribution: "unattributed",
        stallCauseCandidate: null,
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
        inFlightWorkAtObservation: null,
        lastCompletedWork: "sweep:database-maintenance",
      }),
      "Event loop stalled",
    );
    const fields = logger.info.mock.calls[0]?.[0] as {
      lastCompletedWorkWallMs: number | null;
    };
    expect(fields.lastCompletedWorkWallMs).toEqual(expect.any(Number));

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
        inFlightWorkAtObservation:
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
        inFlightWorkAtObservation: "GET /api/v1/second",
        lastCompletedWork: "GET /api/v1/first",
      }),
      "Event loop stalled",
    );

    releaseSecond();
    await second;
    monitor.stop();
  });

  it("reports synchronous wall and CPU separately after later short work", () => {
    installHistogram({
      maxDelayMs: 500,
      meanDelayMs: 25,
      p99DelayMs: 450,
    });
    const logger = { info: vi.fn() };
    const nowSpy = vi.spyOn(nodePerformance, "now");
    const cpuSpy = vi.spyOn(process, "threadCpuUsage");
    cpuSpy.mockReturnValueOnce({ user: 1000, system: 0 });
    cpuSpy.mockReturnValueOnce({ user: 2000, system: 0 });
    cpuSpy.mockReturnValueOnce({ user: 10000, system: 0 });
    cpuSpy.mockReturnValueOnce({ user: 100, system: 0 });
    nowSpy.mockReturnValueOnce(0);
    nowSpy.mockReturnValueOnce(650);
    runEventLoopWorkSync("sweep:database-maintenance", () => undefined);
    nowSpy.mockReturnValueOnce(650);
    nowSpy.mockReturnValueOnce(651);
    runEventLoopWorkSync("ws:daemon heartbeat", () => undefined);
    nowSpy.mockRestore();
    cpuSpy.mockRestore();

    const monitor = startEventLoopStallMonitor({ logger });
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        lastCompletedWork: "ws:daemon heartbeat",
        lastCompletedWorkWallMs: 1,
        longestSynchronousWork: "sweep:database-maintenance",
        longestSynchronousWorkWallMs: 650,
        longestSynchronousWorkCpuMs: 2,
        stallAttribution: "candidate",
        stallCauseCandidate: "sweep:database-maintenance",
      }),
      "Event loop stalled",
    );

    monitor.stop();
  });

  it("leaves a two-second stall unattributed when measured work took one millisecond", () => {
    installHistogram({ maxDelayMs: 2_000, meanDelayMs: 25, p99DelayMs: 450 });
    const logger = { info: vi.fn() };
    const nowSpy = vi.spyOn(nodePerformance, "now");
    try {
      nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1);
      runEventLoopWorkSync("ws:daemon heartbeat", () => undefined);
    } finally {
      nowSpy.mockRestore();
    }
    const monitor = startEventLoopStallMonitor({ logger });
    try {
      vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          maxDelayMs: 2_000,
          longestSynchronousWork: "ws:daemon heartbeat",
          longestSynchronousWorkWallMs: 1,
          stallAttribution: "unattributed",
          stallCauseCandidate: null,
        }),
        "Event loop stalled",
      );
    } finally {
      monitor.stop();
    }
  });

  it.each(["start", "finish", "serialize"] as const)(
    "identifies a slow CPU profile %s as a candidate in stall logs",
    async (phase) => {
      installHistogram({ maxDelayMs: 2_000, meanDelayMs: 25, p99DelayMs: 450 });
      const db = createConnection(":memory:");
      migrate(db);
      setExperiments(db, { performanceDiagnostics: true });
      const dataDir = await mkdtemp(join(tmpdir(), "bb-profile-attribution-"));
      const logger = { info: vi.fn(), warn: vi.fn() };
      const monitor = startEventLoopStallMonitor({ logger });
      let clock = 0;
      const nowSpy = vi
        .spyOn(nodePerformance, "now")
        .mockImplementation(() => clock);
      const start = inspectorConsole.profile;
      const finish = inspectorConsole.profileEnd;
      const stringify = JSON.stringify;
      const startSpy = vi
        .spyOn(inspectorConsole, "profile")
        .mockImplementation((title) => {
          start(title);
          if (phase === "start") clock += 2_000;
        });
      const finishSpy = vi
        .spyOn(inspectorConsole, "profileEnd")
        .mockImplementation((title) => {
          finish(title);
          if (phase === "finish") clock += 2_000;
        });
      const stringifySpy = vi
        .spyOn(JSON, "stringify")
        .mockImplementation((value, replacer, space) => {
          const result = stringify(value, replacer, space);
          if (phase === "serialize" && value && Array.isArray(value.nodes))
            clock += 2_000;
          return result;
        });
      let recorder:
        | Awaited<ReturnType<typeof startGatedPerformanceDiagnostics>>
        | undefined;
      try {
        recorder = await startGatedPerformanceDiagnostics({
          allowed: true,
          dataDir,
          db,
          hub: new NotificationHub(),
          logger,
        });
        await recorder.stop();
        vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(
          expect.objectContaining({
            maxDelayMs: 2_000,
            longestSynchronousWork: `cpu-profile:${phase}`,
            longestSynchronousWorkWallMs: 2_000,
            stallAttribution: "candidate",
            stallCauseCandidate: `cpu-profile:${phase}`,
          }),
          "Event loop stalled",
        );
      } finally {
        await recorder?.stop();
        monitor.stop();
        nowSpy.mockRestore();
        startSpy.mockRestore();
        finishSpy.mockRestore();
        stringifySpy.mockRestore();
        db.$client.close();
        await rm(dataDir, { recursive: true, force: true });
      }
    },
  );
});
