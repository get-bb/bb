import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startEventLoopStallMonitor } from "./event-loop-stall-monitor.js";

describe("host event-loop stall monitor", () => {
  let blockedMs = 0;
  let suspendedMs = 0;

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    blockedMs = 0;
    suspendedMs = 0;
    vi.stubGlobal(
      "process",
      Object.create(process, { platform: { value: "linux" } }),
    );
    vi.spyOn(os, "uptime").mockImplementation(
      () => (Date.now() + blockedMs + suspendedMs) / 1_000,
    );
    vi.spyOn(process.hrtime, "bigint").mockImplementation(() =>
      BigInt(Math.round((Date.now() + blockedMs) * 1_000_000)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reports system suspension separately from a stall", () => {
    const logger = { warn: vi.fn() };
    const monitor = startEventLoopStallMonitor({
      logger,
      now: () => Date.now() + suspendedMs,
    });
    try {
      suspendedMs = 300_000;
      vi.advanceTimersByTime(5_000);

      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ durationMs: 300_000 }),
        "Host daemon system suspension observed",
      );
    } finally {
      monitor.stop();
    }
  });

  it("still reports a sub-minute event-loop stall", () => {
    const logger = { warn: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger });
    try {
      vi.advanceTimersByTime(25);
      blockedMs = 550;
      vi.advanceTimersByTime(4_975);

      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ maxDelayMs: 600, resolutionMs: 50 }),
        "Host daemon event loop stalled",
      );
    } finally {
      monitor.stop();
    }
  });
});
