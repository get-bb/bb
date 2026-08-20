import { afterEach, describe, expect, it, vi } from "vitest";

const perfHooksMock = vi.hoisted(() => ({
  histogram: {
    disable: vi.fn(),
    enable: vi.fn(),
    max: 600_000_000_000,
    mean: 1_000_000,
    percentile: vi.fn(() => 1_000_000),
    reset: vi.fn(),
  },
}));

vi.mock("node:perf_hooks", () => ({
  monitorEventLoopDelay: vi.fn(() => perfHooksMock.histogram),
}));

import { startEventLoopStallMonitor } from "./event-loop-stall-monitor.js";

describe("host event-loop stall monitor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("suppresses histogram delays accumulated while the system was suspended", () => {
    vi.useFakeTimers();
    let now = 0;
    const logger = { warn: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger, now: () => now });

    now = 300_000;
    vi.advanceTimersByTime(5_000);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(perfHooksMock.histogram.reset).toHaveBeenCalledOnce();
    monitor.stop();
  });

  it("still reports a sub-minute event-loop stall", () => {
    vi.useFakeTimers();
    perfHooksMock.histogram.max = 600_000_000;
    let now = 0;
    const logger = { warn: vi.fn() };
    const monitor = startEventLoopStallMonitor({ logger, now: () => now });

    now = 5_000;
    vi.advanceTimersByTime(5_000);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ maxDelayMs: 600 }),
      "Host daemon event loop stalled",
    );
    monitor.stop();
  });
});
