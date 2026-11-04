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
    tag: "tag",
    timelinePage: {
      returnedSegmentCount: 0,
      olderCursor: null,
      historySnapshot: "",
      olderRowsSourceSeqEnd: null,
    },
  };
}

const latestPage: ThreadTimelinePageRequest = {
  kind: "latest",
  segmentLimit: 20,
};

const baseKeyArgs: ThreadTimelineCacheKeyArgs = {
  threadId: "thr_x",
  status: "idle",
  surface: "surface-a",
  page: latestPage,
  summaryOnly: false,
};

describe("createThreadTimelineCache", () => {
  it("builds once for the same key and serves cached on repeat", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    const first = cache.getOrBuild("thr_x", "k", 10, build);
    const second = cache.getOrBuild("thr_x", "k", 10, build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("drops the stale revision and skips caching above the row cap", () => {
    const cache = createThreadTimelineCache({ maxCacheableRows: 5 });
    cache.getOrBuild("thr_x", "k", 9, () => makeResponse(1));
    const build = vi.fn(() => makeResponse(50));

    cache.getOrBuild("thr_x", "k", 10, build);
    cache.getOrBuild("thr_x", "k", 10, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("rebuilds when the thread's maxSeq advances", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(1));

    const first = cache.getOrBuild("thr_x", "k", 10, build);
    const second = cache.getOrBuild("thr_x", "k", 11, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(cache.getOrBuild("thr_x", "k", 11, build)).toBe(second);
    expect(cache.size).toBe(1);
  });

  it("keeps an idle thread cached while another thread streams revisions", () => {
    const cache = createThreadTimelineCache({ maxEntries: 4 });
    const idleBuild = vi.fn(() => makeResponse(1));
    const idle = cache.getOrBuild("thr_idle", "idle", 7, idleBuild);

    for (let maxSeq = 1; maxSeq <= 20; maxSeq += 1) {
      cache.getOrBuild("thr_active", "active", maxSeq, () => makeResponse(1));
    }

    expect(cache.getOrBuild("thr_idle", "idle", 7, idleBuild)).toBe(idle);
    expect(idleBuild).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
  });

  it("evicts least-recently-used entries beyond maxEntries", () => {
    const cache = createThreadTimelineCache({ maxEntries: 2 });
    const build = vi.fn(() => makeResponse(1));

    cache.getOrBuild("thr_x", "a", 10, build);
    cache.getOrBuild("thr_x", "b", 10, build);
    cache.getOrBuild("thr_x", "a", 10, build);
    cache.getOrBuild("thr_x", "c", 10, build);

    expect(cache.size).toBe(2);
    const buildAgain = vi.fn(() => makeResponse(1));
    cache.getOrBuild("thr_x", "a", 10, buildAgain);
    cache.getOrBuild("thr_x", "b", 10, buildAgain);
    expect(buildAgain).toHaveBeenCalledTimes(1);
  });

  it("invalidates only entries for the rewritten thread", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(1));
    cache.getOrBuild("thr_x", "x", 10, build);
    cache.getOrBuild("thr_y", "y", 10, build);

    cache.invalidateThread("thr_x");

    cache.getOrBuild("thr_x", "x", 10, build);
    cache.getOrBuild("thr_y", "y", 10, build);
    expect(build).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(2);
  });
});

describe("buildThreadTimelineCacheKey", () => {
  it("differs when any projection input differs", () => {
    const base = buildThreadTimelineCacheKey(baseKeyArgs);
    const variants: ThreadTimelineCacheKeyArgs[] = [
      { ...baseKeyArgs, status: "active" },
      { ...baseKeyArgs, surface: "surface-b" },
      { ...baseKeyArgs, summaryOnly: true },
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
