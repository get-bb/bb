import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setExperiments } from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { startGatedPerformanceDiagnostics } from "../../src/services/system/performance-diagnostics.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { performance as nodePerformance } from "node:perf_hooks";
import { startEventLoopStallMonitor } from "../../src/services/system/event-loop-stall-monitor.js";
import {
  resetEventLoopWorkForTests,
  runEventLoopWork,
  runEventLoopWorkSync,
} from "../../src/services/system/event-loop-work.js";

const EVENT_LOOP_STALL_MONITOR_INTERVAL_MS = 5_000;
const EVENT_LOOP_GAP_INTERVAL_MS = 50;

let blockedMs = 0;

function advanceSampleWindow(maxDelayMs?: number): void {
  if (maxDelayMs === undefined) {
    vi.advanceTimersByTime(EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);
    return;
  }
  vi.advanceTimersByTime(EVENT_LOOP_GAP_INTERVAL_MS / 2);
  blockedMs += maxDelayMs - EVENT_LOOP_GAP_INTERVAL_MS;
  vi.advanceTimersByTime(
    EVENT_LOOP_STALL_MONITOR_INTERVAL_MS - EVENT_LOOP_GAP_INTERVAL_MS / 2,
  );
}

const EMPTY_WORK_SNAPSHOT = {
  inFlightWorkAtObservation: null,
  lastCompletedWork: null,
  lastCompletedWorkWallMs: null,
  longestSynchronousWork: null,
  longestSynchronousWorkCaller: null,
  longestSynchronousWorkWallMs: null,
  longestSynchronousWorkCpuMs: null,
  longestSynchronousWorkVoluntaryContextSwitches: null,
  longestSynchronousWorkInvoluntaryContextSwitches: null,
};

describe("event loop stall monitor", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    blockedMs = 0;
    vi.spyOn(process.hrtime, "bigint").mockImplementation(() =>
      BigInt(Math.round((Date.now() + blockedMs) * 1_000_000)),
    );
    resetEventLoopWorkForTests();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([undefined, 100])(
    "logs and resets at the configured threshold %s",
    (thresholdMs) => {
      const expectedThreshold = thresholdMs ?? 500;
      const logger = { info: vi.fn() };

      const monitor = startEventLoopStallMonitor({ logger, thresholdMs });
      advanceSampleWindow(expectedThreshold);
      advanceSampleWindow();

      expect(logger.info).toHaveBeenCalledOnce();
      expect(logger.info).toHaveBeenCalledWith(
        {
          intervalMs: 5_000,
          maxDelayMs: expectedThreshold,
          meanDelayMs: (expectedThreshold + 99 * 50) / 100,
          p99DelayMs: expect.closeTo(50, 0),
          resolutionMs: 50,
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
    const logger = { info: vi.fn() };
    let enabled = true;
    const monitor = startEventLoopStallMonitor({
      logger,
      thresholdMs: () => (enabled ? 100 : 500),
    });
    advanceSampleWindow(150);
    expect(logger.info).toHaveBeenCalledTimes(1);
    enabled = false;
    advanceSampleWindow(150);
    expect(logger.info).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it("does not log below the threshold", () => {
    const logger = { info: vi.fn() };

    const monitor = startEventLoopStallMonitor({ logger });
    advanceSampleWindow(499);

    expect(logger.info).not.toHaveBeenCalled();

    monitor.stop();
  });

  it("stops sampling after stop", () => {
    const logger = { info: vi.fn() };

    const monitor = startEventLoopStallMonitor({ logger });
    monitor.stop();
    expect(vi.getTimerCount()).toBe(0);
    advanceSampleWindow(500);

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

    advanceSampleWindow(500);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        inFlightWorkAtObservation: "GET /api/v1/threads/thr_example/timeline",
        lastCompletedWork: null,
        lastCompletedWorkWallMs: null,
        longestSynchronousWork:
          "GET /api/v1/threads/thr_example/timeline (until first await)",
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
    const logger = { info: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger });

    runEventLoopWorkSync("sweep:database-maintenance", () => undefined);
    advanceSampleWindow(500);

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

    advanceSampleWindow(500);

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
    advanceSampleWindow(500);

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
    advanceSampleWindow(500);

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
      advanceSampleWindow(2_000);
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

  it("serializes CPU profiles outside the server thread", async () => {
    const db = createMigratedConnection();
    setExperiments(db, { performanceDiagnostics: true });
    const dataDir = await mkdtemp(join(tmpdir(), "bb-profile-attribution-"));
    const logger = { info: vi.fn(), warn: vi.fn() };
    const stringify = JSON.stringify;
    const serializedProfiles: unknown[] = [];
    const stringifySpy = vi
      .spyOn(JSON, "stringify")
      .mockImplementation((value, replacer, space) => {
        if (value && Array.isArray(value.nodes)) serializedProfiles.push(value);
        return stringify(value, replacer, space);
      });
    let recorder:
      | Awaited<ReturnType<typeof startGatedPerformanceDiagnostics>>
      | undefined;
    try {
      recorder = await startGatedPerformanceDiagnostics({
        allowed: true,
        codeOwners: () => [],
        dataDir,
        db,
        hub: new NotificationHub(),
        logger,
      });
      await recorder.stop();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringMatching(/\.cpuprofile$/),
        }),
        "Server CPU profile saved",
      );
      expect(serializedProfiles).toEqual([]);
    } finally {
      await recorder?.stop();
      stringifySpy.mockRestore();
      db.$client.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
