import { performance } from "node:perf_hooks";
import { vi } from "vitest";

export function holdPerformanceClockStill(): void {
  vi.spyOn(performance, "now").mockReturnValue(1_000_000);
}
