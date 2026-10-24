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
  maxSeq: 10,
  status: "idle",
  surface: "surface-a",
  page: latestPage,
  summaryOnly: false,
};

describe("createThreadTimelineCache", () => {
  it("builds once for the same key and serves cached on repeat", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    const first = cache.getOrBuild("thr_x", "k", build);
    const second = cache.getOrBuild("thr_x", "k", build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("shares large timeline pages between identical requests", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(1_500));

    const first = cache.getOrBuild("thr_x", "k", build);
    const second = cache.getOrBuild("thr_x", "k", build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("does not retain a response exceeding the byte budget", () => {
    const response = makeResponse(1);
    response.timelinePage.historySnapshot = "界".repeat(1_000);
    const maxBytes = JSON.stringify(response).length;
    const cache = createThreadTimelineCache({ maxBytes });
    const build = vi.fn(() => response);

    cache.getOrBuild("thr_x", "k", build);
    cache.getOrBuild("thr_x", "k", build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("evicts by total bytes in access order and releases invalidated bytes", () => {
    const response = makeResponse(20);
    const maxBytes = Buffer.byteLength(JSON.stringify(response)) * 2;
    const cache = createThreadTimelineCache({ maxBytes });
    const build = vi.fn(() => response);

    cache.getOrBuild("thr_x", "a", build);
    cache.getOrBuild("thr_y", "b", build);
    cache.getOrBuild("thr_x", "a", build);
    cache.getOrBuild("thr_z", "c", build);
    cache.getOrBuild("thr_x", "a", build);
    expect(build).toHaveBeenCalledTimes(3);

    cache.invalidateThread("thr_x");
    cache.getOrBuild("thr_y", "b", build);
    cache.getOrBuild("thr_z", "c", build);
    expect(build).toHaveBeenCalledTimes(4);
    expect(cache.size).toBe(2);
  });

  it("evicts least-recently-used entries beyond maxEntries", () => {
    const cache = createThreadTimelineCache({ maxEntries: 2 });
    const build = vi.fn(() => makeResponse(1));

    cache.getOrBuild("thr_x", "a", build);
    cache.getOrBuild("thr_x", "b", build);
    cache.getOrBuild("thr_x", "a", build);
    cache.getOrBuild("thr_x", "c", build);

    expect(cache.size).toBe(2);
    const buildAgain = vi.fn(() => makeResponse(1));
    cache.getOrBuild("thr_x", "a", buildAgain);
    cache.getOrBuild("thr_x", "b", buildAgain);
    expect(buildAgain).toHaveBeenCalledTimes(1);
  });

  it("invalidates only entries for the rewritten thread", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(1));
    cache.getOrBuild("thr_x", "x", build);
    cache.getOrBuild("thr_y", "y", build);

    cache.invalidateThread("thr_x");

    cache.getOrBuild("thr_x", "x", build);
    cache.getOrBuild("thr_y", "y", build);
    expect(build).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(2);
  });
});

describe("buildThreadTimelineCacheKey", () => {
  it("differs when any projection input differs", () => {
    const base = buildThreadTimelineCacheKey(baseKeyArgs);
    const variants: ThreadTimelineCacheKeyArgs[] = [
      { ...baseKeyArgs, maxSeq: 11 },
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
