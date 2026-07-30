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

describe("createThreadTimelineCache", () => {
  it("builds once for the same key and serves cached on repeat", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    const first = cache.getOrBuild(baseKeyArgs, build);
    const second = cache.getOrBuild(baseKeyArgs, build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("rebuilds when the key changes (e.g. new maxSeq)", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    cache.getOrBuild(baseKeyArgs, build);
    cache.getOrBuild({ ...baseKeyArgs, maxSeq: 11 }, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });

  it("retains only the newest revision for the same request shape", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(3));

    for (let maxSeq = 1; maxSeq <= 128; maxSeq += 1) {
      cache.getOrBuild({ ...baseKeyArgs, maxSeq }, build);
    }

    expect(build).toHaveBeenCalledTimes(128);
    expect(cache.size).toBe(1);
  });

  it("does not cache responses above the row cap (streaming expanded turns)", () => {
    const cache = createThreadTimelineCache({ maxCacheableRows: 5 });
    const build = vi.fn(() => makeResponse(50));

    cache.getOrBuild(baseKeyArgs, build);
    cache.getOrBuild(baseKeyArgs, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("drops an obsolete revision when its replacement exceeds the row cap", () => {
    const cache = createThreadTimelineCache({ maxCacheableRows: 5 });
    cache.getOrBuild(baseKeyArgs, () => makeResponse(3));

    const buildLarge = vi.fn(() => makeResponse(50));
    const nextRevision = { ...baseKeyArgs, maxSeq: 11 };
    cache.getOrBuild(nextRevision, buildLarge);

    expect(cache.size).toBe(0);
    cache.getOrBuild(nextRevision, buildLarge);
    expect(buildLarge).toHaveBeenCalledTimes(2);
  });

  it("preserves the prior revision when its replacement build fails", () => {
    const cache = createThreadTimelineCache();
    const first = cache.getOrBuild(baseKeyArgs, () => makeResponse(3));

    expect(() =>
      cache.getOrBuild({ ...baseKeyArgs, maxSeq: 11 }, () => {
        throw new Error("build failed");
      }),
    ).toThrow("build failed");

    expect(cache.getOrBuild(baseKeyArgs, () => makeResponse(4))).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("keeps different request shapes independently cached", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => makeResponse(1));
    const summaryKeyArgs = { ...baseKeyArgs, summaryOnly: true };

    cache.getOrBuild(baseKeyArgs, build);
    cache.getOrBuild(summaryKeyArgs, build);
    cache.getOrBuild(baseKeyArgs, build);
    cache.getOrBuild(summaryKeyArgs, build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(2);
  });

  it("evicts least-recently-used entries beyond maxEntries", () => {
    const cache = createThreadTimelineCache({ maxEntries: 2 });
    const build = vi.fn(() => makeResponse(1));
    const a1 = { ...baseKeyArgs, threadId: "thr_a", maxSeq: 1 };
    const a2 = { ...a1, maxSeq: 2 };
    const b1 = { ...baseKeyArgs, threadId: "thr_b", maxSeq: 1 };
    const c1 = { ...baseKeyArgs, threadId: "thr_c", maxSeq: 1 };

    cache.getOrBuild(a1, build); // [a1]
    cache.getOrBuild(b1, build); // [a1,b1]
    cache.getOrBuild(a2, build); // replace a1 -> [b1,a2]
    cache.getOrBuild(c1, build); // evict b1 -> [a2,c1]

    expect(cache.size).toBe(2);
    const buildAgain = vi.fn(() => makeResponse(1));
    cache.getOrBuild(a2, buildAgain); // still cached
    cache.getOrBuild(b1, buildAgain); // evicted -> rebuild
    expect(buildAgain).toHaveBeenCalledTimes(1);
  });
});

describe("buildThreadTimelineCacheKey", () => {
  it("is stable for identical inputs", () => {
    expect(buildThreadTimelineCacheKey(baseKeyArgs)).toBe(
      buildThreadTimelineCacheKey({ ...baseKeyArgs }),
    );
  });

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
