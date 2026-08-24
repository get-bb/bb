import { describe, expect, it, vi } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadTimelinePageRequest } from "../../../src/services/threads/timeline-pagination.js";
import {
  buildThreadTimelineCacheKey,
  createThreadTimelineCache,
  type ThreadTimelineCacheKeyArgs,
} from "../../../src/services/threads/timeline-cache.js";

function makeResponse(rowCount: number): ThreadTimelineResponse {
  return {
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `row-${index}`,
      kind: "system",
      threadId: "thr_x",
      turnId: null,
      sourceSeqStart: index,
      sourceSeqEnd: index,
      startedAt: 0,
      createdAt: 0,
      systemKind: "debug",
      title: "t",
      detail: null,
      status: null,
    })),
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    maxSeq: 0,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

const latestPage: ThreadTimelinePageRequest = {
  kind: "latest",
  segmentLimit: 20,
};

const baseKeyArgs: ThreadTimelineCacheKeyArgs = {
  threadId: "thr_x",
  maxSeq: 10,
  status: "idle",
  environmentId: null,
  page: latestPage,
  includeNestedRows: false,
  summaryOnly: false,
  includeProviderUnhandledOperations: false,
};

/** Give each key its own params key to exercise the LRU in isolation. */
function keys(key: string): { key: string; paramsKey: string } {
  return { key, paramsKey: `params:${key}` };
}

describe("createThreadTimelineCache", () => {
  it("builds once for the same key and serves cached on repeat", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    const first = cache.getOrBuild(keys("k"), build);
    const second = cache.getOrBuild(keys("k"), build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("rebuilds when the key changes (e.g. new maxSeq)", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    cache.getOrBuild(keys("k1"), build);
    cache.getOrBuild(keys("k2"), build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("does not retain responses above the row cap beyond the share window", () => {
    let nowMs = 0;
    const cache = createThreadTimelineCache({
      maxCacheableRows: 5,
      shareWindowMs: 250,
      now: () => nowMs,
    });
    const build = vi.fn(() => makeResponse(50));

    cache.getOrBuild(keys("k"), build);
    nowMs += 251;
    cache.getOrBuild(keys("k"), build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("evicts least-recently-used entries beyond maxEntries", () => {
    let nowMs = 0;
    const cache = createThreadTimelineCache({ maxEntries: 2, now: () => nowMs });
    const build = vi.fn(() => makeResponse(1));

    cache.getOrBuild(keys("a"), build); // [a]
    cache.getOrBuild(keys("b"), build); // [a,b]
    cache.getOrBuild(keys("a"), build); // touch a -> [b,a]
    cache.getOrBuild(keys("c"), build); // evict b -> [a,c]

    expect(cache.size).toBe(2);
    // Step past the share window so the LRU alone answers the reprobe.
    nowMs += 300;
    const buildAgain = vi.fn(() => makeResponse(1));
    cache.getOrBuild(keys("a"), buildAgain); // still cached
    cache.getOrBuild(keys("b"), buildAgain); // evicted -> rebuild
    expect(buildAgain).toHaveBeenCalledTimes(1);
  });
});

describe("createThreadTimelineCache share window", () => {
  function createSharedCache(now: () => number) {
    return createThreadTimelineCache({
      maxCacheableRows: 5,
      shareWindowMs: 250,
      now,
    });
  }

  it("shares one build across same-key requests inside the window regardless of row count", () => {
    let nowMs = 0;
    const cache = createSharedCache(() => nowMs);
    const build = vi.fn(() => makeResponse(50));

    const first = cache.getOrBuild(keys("k"), build);
    nowMs += 100;
    const second = cache.getOrBuild(keys("k"), build);

    expect(build).toHaveBeenCalledTimes(1);
    // Same revision must mean identical rows for every client.
    expect(second).toBe(first);
    // Shared, not retained: the LRU row cap still applies.
    expect(cache.size).toBe(0);
  });

  it("floors rebuilds of over-cap windows: a new maxSeq inside the window gets the prior window", () => {
    let nowMs = 0;
    const cache = createSharedCache(() => nowMs);
    const build = vi.fn(() => makeResponse(50));

    const first = cache.getOrBuild({ key: "10|p", paramsKey: "p" }, build);
    nowMs += 100;
    const floored = cache.getOrBuild({ key: "11|p", paramsKey: "p" }, build);
    expect(build).toHaveBeenCalledTimes(1);
    expect(floored).toBe(first);

    nowMs += 200; // 300ms since the build: past the window.
    const rebuilt = cache.getOrBuild({ key: "12|p", paramsKey: "p" }, build);
    expect(build).toHaveBeenCalledTimes(2);
    expect(rebuilt).not.toBe(first);
  });

  it("keeps rebuilds eager for LRU-cacheable windows (no floor below the row cap)", () => {
    let nowMs = 0;
    const cache = createSharedCache(() => nowMs);
    const build = vi.fn(() => makeResponse(3));

    cache.getOrBuild({ key: "10|p", paramsKey: "p" }, build);
    nowMs += 10;
    cache.getOrBuild({ key: "11|p", paramsKey: "p" }, build);

    expect(build).toHaveBeenCalledTimes(2);
  });

  it("never floors across params keys (a status flip builds fresh)", () => {
    let nowMs = 0;
    const cache = createSharedCache(() => nowMs);
    const build = vi.fn(() => makeResponse(50));

    cache.getOrBuild({ key: "10|p:active", paramsKey: "p:active" }, build);
    nowMs += 10;
    cache.getOrBuild(
      { key: "11|p:interrupted", paramsKey: "p:interrupted" },
      build,
    );

    expect(build).toHaveBeenCalledTimes(2);
  });
});

describe("buildThreadTimelineCacheKey", () => {
  it("differs when any projection input differs", () => {
    const base = buildThreadTimelineCacheKey(baseKeyArgs);
    const variants: ThreadTimelineCacheKeyArgs[] = [
      { ...baseKeyArgs, maxSeq: 11 },
      { ...baseKeyArgs, status: "active" },
      { ...baseKeyArgs, environmentId: "env_1" },
      { ...baseKeyArgs, includeNestedRows: true },
      { ...baseKeyArgs, summaryOnly: true },
      { ...baseKeyArgs, includeProviderUnhandledOperations: true },
      {
        ...baseKeyArgs,
        page: {
          kind: "older",
          segmentLimit: 20,
          beforeCursor: { anchorSeq: 5, anchorId: "a5" },
        },
      },
    ];
    for (const variant of variants) {
      expect(buildThreadTimelineCacheKey(variant)).not.toBe(base);
    }
  });

  it("distinguishes older-page cursors", () => {
    const cursorA = buildThreadTimelineCacheKey({
      ...baseKeyArgs,
      page: {
        kind: "older",
        segmentLimit: 20,
        beforeCursor: { anchorSeq: 5, anchorId: "a5" },
      },
    });
    const cursorB = buildThreadTimelineCacheKey({
      ...baseKeyArgs,
      page: {
        kind: "older",
        segmentLimit: 20,
        beforeCursor: { anchorSeq: 6, anchorId: "a6" },
      },
    });
    expect(cursorA).not.toBe(cursorB);
  });
});
