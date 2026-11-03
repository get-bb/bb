import { afterEach, describe, expect, it, vi } from "vitest";
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

function windowBytes(): number {
  return timelineWindowJsonLength(served("x"));
}

function cacheWith(
  options: { maxBytes?: number; maxThreads?: number } = {},
  subscriberTags: ReadonlySet<string> = new Set(),
) {
  return createTimelineServedWindowsCache({
    ...options,
    subscriberTags: () => subscriberTags,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createTimelineServedWindowsCache", () => {
  it("keeps only the latest pushed window per request key when nobody holds the others", () => {
    const cache = cacheWith();
    cache.recordPushed("thr_x", "default", served("a"));
    cache.recordPushed("thr_x", "compact", served("b"));
    cache.recordPushed("thr_x", "default", served("c"));
    expect(cache.get("thr_x", "a")).toBeUndefined();
    expect(cache.get("thr_x", "b")?.tag).toBe("b");
    expect(cache.latest("thr_x", "default")?.tag).toBe("c");
    expect(cache.latest("thr_x", "compact")?.tag).toBe("b");
    expect(cache.latest("thr_x", "other")).toBeUndefined();
  });

  it("keeps windows that subscribers hold until they move on", () => {
    const held = new Set(["a"]);
    const cache = cacheWith({}, held);
    cache.recordPushed("thr_x", "default", served("a"));
    cache.recordPushed("thr_x", "default", served("b"));
    cache.recordPushed("thr_x", "default", served("c"));
    expect(cache.get("thr_x", "a")?.tag).toBe("a");
    expect(cache.get("thr_x", "b")).toBeUndefined();
    held.delete("a");
    cache.recordPushed("thr_x", "default", served("d"));
    expect(cache.get("thr_x", "a")).toBeUndefined();
  });

  it("holds a read window for its reader until the hold expires", () => {
    vi.useFakeTimers();
    const cache = cacheWith();
    cache.recordRead("thr_x", "default", served("a"), undefined);
    cache.recordPushed("thr_x", "default", served("b"));
    expect(cache.get("thr_x", "a")?.tag).toBe("a");
    vi.advanceTimersByTime(30_001);
    cache.recordPushed("thr_x", "default", served("c"));
    expect(cache.get("thr_x", "a")).toBeUndefined();
  });

  it("releases a read window when its reader reads again with that tag", () => {
    const cache = cacheWith();
    cache.recordRead("thr_x", "default", served("a"), undefined);
    cache.recordRead("thr_x", "default", served("a"), undefined);
    cache.recordRead("thr_x", "default", served("b"), "a");
    expect(cache.get("thr_x", "a")?.tag).toBe("a");
    cache.recordRead("thr_x", "default", served("c"), "a");
    expect(cache.get("thr_x", "a")).toBeUndefined();
    expect(cache.get("thr_x", "b")?.tag).toBe("b");
  });

  it("releases a read window once its reader subscribes with that tag", () => {
    const cache = cacheWith();
    cache.recordRead("thr_x", "default", served("a"), undefined);
    cache.release("thr_x", "a");
    cache.recordPushed("thr_x", "default", served("b"));
    expect(cache.get("thr_x", "a")).toBeUndefined();
  });

  it("bounds threads LRU-style; a lookup counts as use", () => {
    const cache = cacheWith({ maxThreads: 2 });
    cache.recordPushed("thr_a", "k", served("a"));
    cache.recordPushed("thr_b", "k", served("b"));
    expect(cache.get("thr_a", "a")).toBeDefined();
    cache.recordPushed("thr_c", "k", served("c"));
    expect(cache.size).toBe(2);
    expect(cache.get("thr_b", "b")).toBeUndefined();
    expect(cache.get("thr_a", "a")?.tag).toBe("a");
  });

  it("drops only the invalidated thread and frees its bytes", () => {
    const cache = cacheWith({ maxBytes: Math.floor(windowBytes() * 4.5) });
    cache.recordPushed("thr_x", "k", served("x"));
    cache.recordPushed("thr_y", "k", served("y"));
    cache.recordPushed("thr_w", "k", served("w"));
    cache.recordPushed("thr_v", "k", served("v"));
    cache.invalidateThread("thr_x");
    cache.recordPushed("thr_z", "k", served("z"));
    expect(cache.get("thr_x", "x")).toBeUndefined();
    expect(cache.get("thr_y", "y")?.tag).toBe("y");
    expect(cache.get("thr_z", "z")?.tag).toBe("z");
  });

  it("evicts the least recently used threads once windows exceed the byte budget", () => {
    const cache = cacheWith({ maxBytes: Math.floor(windowBytes() * 4.5) });
    for (const threadId of ["thr_a", "thr_b", "thr_c", "thr_d"]) {
      cache.recordPushed(threadId, "k", served(threadId));
    }
    expect(cache.get("thr_a", "thr_a")).toBeDefined();
    cache.recordPushed("thr_e", "k", served("thr_e"));
    expect(cache.get("thr_b", "thr_b")).toBeUndefined();
    expect(cache.get("thr_a", "thr_a")?.tag).toBe("thr_a");
    expect(cache.get("thr_e", "thr_e")?.tag).toBe("thr_e");
  });

  it("keeps the newest windows of a thread that alone exceeds the byte budget", () => {
    const cache = cacheWith(
      { maxBytes: Math.floor(windowBytes() * 4.5) },
      new Set(["a", "b", "c", "d", "e", "f"]),
    );
    for (const tag of ["a", "b", "c", "d", "e", "f"]) {
      cache.recordPushed("thr_x", "k", served(tag));
    }
    expect(cache.get("thr_x", "b")).toBeUndefined();
    expect(cache.get("thr_x", "c")?.tag).toBe("c");
    expect(cache.get("thr_x", "f")?.tag).toBe("f");
  });

  it("counts a window recorded again under the same tag once", () => {
    const cache = cacheWith({ maxBytes: Math.floor(windowBytes() * 4.5) });
    for (let index = 0; index < 5; index += 1) {
      cache.recordPushed("thr_a", "k", served("a"));
    }
    for (const threadId of ["thr_b", "thr_c", "thr_d"]) {
      cache.recordPushed(threadId, "k", served(threadId));
    }
    expect(cache.get("thr_a", "a")?.tag).toBe("a");
    expect(cache.get("thr_d", "thr_d")?.tag).toBe("thr_d");
  });

  it("does not keep a window larger than a quarter of the budget", () => {
    const cache = cacheWith({ maxBytes: Math.floor(windowBytes() * 4.5) });
    const oversized = served("o".repeat(windowBytes()));
    cache.recordPushed("thr_a", "k", served("a"));
    cache.recordPushed("thr_b", "k", served("b"));
    cache.recordPushed("thr_b", "k", oversized);
    expect(cache.get("thr_b", oversized.tag)).toBeUndefined();
    expect(cache.get("thr_b", "b")?.tag).toBe("b");
    expect(cache.get("thr_a", "a")?.tag).toBe("a");
  });
});
