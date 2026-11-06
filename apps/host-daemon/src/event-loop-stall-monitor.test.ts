import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startEventLoopStallMonitor } from "./event-loop-stall-monitor.js";

describe("host event-loop stall monitor", () => {
  let blockedMs = 0;

  beforeEach(() => {
    vi.useFakeTimers({ now: 0 });
    blockedMs = 0;
    vi.spyOn(process.hrtime, "bigint").mockImplementation(() =>
      BigInt(Math.round((Date.now() + blockedMs) * 1_000_000)),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function blockBeforeNextTick(gapMs: number): void {
    vi.advanceTimersByTime(25);
    blockedMs += gapMs - 50;
  }

  it("suppresses delays accumulated while the system was suspended", () => {
    let now = 0;
    const logger = { warn: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger, now: () => now });

    blockBeforeNextTick(600);
    now = 300_000;
    vi.advanceTimersByTime(4_975);

    expect(logger.warn).not.toHaveBeenCalled();
    monitor.stop();
  });

  it("still reports a sub-minute event-loop stall", () => {
    let now = 0;
    const logger = { warn: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger, now: () => now });

    blockBeforeNextTick(600);
    now = 5_000;
    vi.advanceTimersByTime(4_975);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ maxDelayMs: 600, resolutionMs: 50 }),
      "Host daemon event loop stalled",
    );
    monitor.stop();
  });
});
