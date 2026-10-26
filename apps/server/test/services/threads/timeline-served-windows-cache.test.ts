import { describe, expect, it } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { createTimelineServedWindowsCache } from "../../../src/services/threads/timeline-served-windows-cache.js";
import { timelineWindowJsonLength } from "../../../src/services/threads/timeline-window-tag.js";

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

function twoWindowsOfBytes(): number {
  return Math.floor(timelineWindowJsonLength(served("x")) * 2.5);
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

  it("drops only the invalidated thread and frees its bytes", () => {
    const cache = createTimelineServedWindowsCache({
      maxBytes: twoWindowsOfBytes(),
    });
    cache.set("thr_x", "k", served("x"));
    cache.set("thr_y", "k", served("y"));
    cache.invalidateThread("thr_x");
    expect(cache.get("thr_x", "x")).toBeUndefined();
    cache.set("thr_z", "k", served("z"));
    expect(cache.get("thr_y", "y")?.tag).toBe("y");
    expect(cache.get("thr_z", "z")?.tag).toBe("z");
  });

  it("evicts the least recently used threads once windows exceed the byte budget", () => {
    const cache = createTimelineServedWindowsCache({
      maxBytes: twoWindowsOfBytes(),
    });
    cache.set("thr_a", "k", served("a"));
    cache.set("thr_b", "k", served("b"));
    expect(cache.get("thr_a", "a")).toBeDefined();
    cache.set("thr_c", "k", served("c"));
    expect(cache.get("thr_b", "b")).toBeUndefined();
    expect(cache.get("thr_a", "a")?.tag).toBe("a");
    expect(cache.get("thr_c", "c")?.tag).toBe("c");
  });

  it("keeps the newest windows of a thread that alone exceeds the byte budget", () => {
    const cache = createTimelineServedWindowsCache({
      maxBytes: twoWindowsOfBytes(),
    });
    for (const tag of ["a", "b", "c", "d"]) {
      cache.set("thr_x", "k", served(tag));
    }
    expect(cache.get("thr_x", "b")).toBeUndefined();
    expect(cache.get("thr_x", "c")?.tag).toBe("c");
    expect(cache.get("thr_x", "d")?.tag).toBe("d");
  });

  it("counts a window served again under the same tag once", () => {
    const cache = createTimelineServedWindowsCache({
      maxBytes: twoWindowsOfBytes(),
    });
    for (let index = 0; index < 5; index += 1) {
      cache.set("thr_a", "k", served("a"));
    }
    cache.set("thr_b", "k", served("b"));
    expect(cache.get("thr_a", "a")?.tag).toBe("a");
    expect(cache.get("thr_b", "b")?.tag).toBe("b");
  });
});
