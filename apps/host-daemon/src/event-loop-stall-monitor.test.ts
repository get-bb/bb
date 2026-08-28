import { afterEach, describe, expect, it, vi } from "vitest";

import { startEventLoopStallMonitor } from "./event-loop-stall-monitor.js";

describe("host event-loop stall monitor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("suppresses histogram delays accumulated while the system was suspended", () => {
    vi.useFakeTimers();
    let now = 0;
    const logger = { warn: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger, now: () => now });

    now = 300_000;
    vi.advanceTimersByTime(5_000);

    expect(logger.warn).not.toHaveBeenCalled();
    monitor.stop();
  });

  it("still reports a sub-minute event-loop stall", async () => {
    let now = 0;
    const logger = { warn: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger, now: () => now });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const stallStartedAt = process.hrtime.bigint();
    while (process.hrtime.bigint() - stallStartedAt < 600_000_000n) {}
    now = 5_000;
    await new Promise((resolve) => setTimeout(resolve, 5_100));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ maxDelayMs: expect.any(Number) }),
      "Host daemon event loop stalled",
    );
    monitor.stop();
  });
});
