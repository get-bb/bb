import { afterEach, expect, it, vi } from "vitest";
import {
  startStallWindowCollector,
  parseStallWindowBatch,
} from "../src/stall-windows.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("bounds queued stall windows and drains their overflow count with the batch", () => {
  vi.useFakeTimers();
  let time = 0n;
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => time);
  const collector = startStallWindowCollector();
  try {
    for (let i = 0; i < 130; i++) {
      time += 200_000_000n;
      vi.advanceTimersByTime(20);
    }
    const batch = parseStallWindowBatch(collector.take());
    expect(batch.windows).toHaveLength(128);
    expect(batch.droppedWindows).toBe(2);
    expect(batch.windows[0]).toEqual({ startedAt: 0, endedAt: 200 });
    expect(collector.take()).toMatchObject({ windows: [], droppedWindows: 0 });
    time += 60_000_000_000n;
    vi.advanceTimersByTime(20);
    expect(collector.take().windows).toEqual([]);
  } finally {
    collector.stop();
  }
});
