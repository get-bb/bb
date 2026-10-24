import { describe, expect, it } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { createTimelineServedWindowsCache } from "../../../src/services/threads/timeline-served-windows-cache.js";

function served(tag: string): ThreadTimelineResponse {
  return {
    rows: [],
    contextBoundarySeq: null,
    completedTurnDisplay: "collapse",
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    providerCommands: null,
    sessionOptions: null,
    modelFallback: null,
    maxSeq: 0,
    tag,
    timelinePage: {
      returnedSegmentCount: 0,
      olderCursor: null,
      historySnapshot: "snapshot",
      olderRowsSourceSeqEnd: null,
    },
  };
}

describe("createTimelineServedWindowsCache", () => {
  it("finds a served window by tag across request keys and evicts the oldest", () => {
    const cache = createTimelineServedWindowsCache({ ringSize: 3 });
    cache.set("thr_x", "default", served("a"));
    cache.set("thr_x", "compact", served("b"));
    cache.set("thr_x", "default", served("c"));
    expect(cache.get("thr_x", "b")?.tag).toBe("b");
    expect(cache.get("thr_y", "b")).toBeUndefined();

    cache.set("thr_x", "default", served("d"));
    expect(cache.get("thr_x", "a")).toBeUndefined();
    expect(cache.get("thr_x", "c")?.tag).toBe("c");
  });

  it("returns the most recent window served for a request key", () => {
    const cache = createTimelineServedWindowsCache();
    cache.set("thr_x", "default", served("a"));
    cache.set("thr_x", "compact", served("b"));
    expect(cache.latest("thr_x", "default")?.tag).toBe("a");
    cache.set("thr_x", "default", served("c"));
    cache.set("thr_x", "default", served("a"));
    expect(cache.latest("thr_x", "default")?.tag).toBe("a");
    expect(cache.latest("thr_x", "other")).toBeUndefined();
  });

  it("bounds threads LRU-style; a lookup counts as use", () => {
    const cache = createTimelineServedWindowsCache({ maxThreads: 2 });
    cache.set("thr_a", "k", served("a"));
    cache.set("thr_b", "k", served("b"));
    expect(cache.get("thr_a", "a")).toBeDefined();
    cache.set("thr_c", "k", served("c"));
    expect(cache.size).toBe(2);
    expect(cache.get("thr_b", "b")).toBeUndefined();
    expect(cache.get("thr_a", "a")?.tag).toBe("a");
  });

  it("drops only the invalidated thread", () => {
    const cache = createTimelineServedWindowsCache();
    cache.set("thr_x", "k", served("x"));
    cache.set("thr_y", "k", served("y"));
    cache.invalidateThread("thr_x");
    expect(cache.get("thr_x", "x")).toBeUndefined();
    expect(cache.get("thr_y", "y")?.tag).toBe("y");
  });
});
