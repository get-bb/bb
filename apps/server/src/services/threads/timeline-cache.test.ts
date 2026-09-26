import { describe, expect, it, vi } from "vitest";
import { createThreadTimelineCache } from "./timeline-cache.js";

function responseWithRows(rowCount: number): { rows: number[] } {
  return { rows: Array.from({ length: rowCount }, (_, index) => index) };
}

describe("createThreadTimelineCache", () => {
  it("serves repeated requests for large timelines from the cache", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => responseWithRows(378));

    const first = cache.getOrBuild("thr_a", "thr_a|1", build);
    const second = cache.getOrBuild("thr_a", "thr_a|1", build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("does not retain responses above the cacheable row limit", () => {
    const cache = createThreadTimelineCache({ maxCacheableRows: 100 });
    const build = vi.fn(() => responseWithRows(101));

    cache.getOrBuild("thr_a", "thr_a|1", build);
    cache.getOrBuild("thr_a", "thr_a|1", build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("evicts the oldest entries to stay within the total row budget", () => {
    const cache = createThreadTimelineCache({
      maxCacheableRows: 500,
      maxTotalRows: 1_000,
    });
    cache.getOrBuild("thr_a", "thr_a|1", () => responseWithRows(400));
    cache.getOrBuild("thr_b", "thr_b|1", () => responseWithRows(400));
    cache.getOrBuild("thr_c", "thr_c|1", () => responseWithRows(400));

    expect(cache.size).toBe(2);
    const rebuildA = vi.fn(() => responseWithRows(400));
    cache.getOrBuild("thr_a", "thr_a|1", rebuildA);
    expect(rebuildA).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
  });

  it("keeps a single entry that exceeds the total row budget on its own", () => {
    const cache = createThreadTimelineCache({
      maxCacheableRows: 500,
      maxTotalRows: 300,
    });
    const build = vi.fn(() => responseWithRows(400));

    cache.getOrBuild("thr_a", "thr_a|1", build);
    cache.getOrBuild("thr_a", "thr_a|1", build);

    expect(build).toHaveBeenCalledTimes(1);
  });

  it("releases the row budget when a thread is invalidated", () => {
    const cache = createThreadTimelineCache({
      maxCacheableRows: 500,
      maxTotalRows: 1_000,
    });
    cache.getOrBuild("thr_a", "thr_a|1", () => responseWithRows(400));
    cache.getOrBuild("thr_b", "thr_b|1", () => responseWithRows(400));
    cache.invalidateThread("thr_a");
    cache.getOrBuild("thr_c", "thr_c|1", () => responseWithRows(400));

    expect(cache.size).toBe(2);
    const rebuildB = vi.fn(() => responseWithRows(400));
    cache.getOrBuild("thr_b", "thr_b|1", rebuildB);
    expect(rebuildB).not.toHaveBeenCalled();
  });
});
