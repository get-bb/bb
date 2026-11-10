import { describe, expect, it, vi } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { ThreadTimelinePageRequest } from "../../../src/services/threads/timeline-pagination.js";
import {
  buildThreadTimelineCacheKey,
  buildThreadTimelineCacheRevision,
  createThreadTimelineCache,
  type ThreadTimelineCacheKeyArgs,
  type ThreadTimelineCacheRevisionArgs,
} from "../../../src/services/threads/timeline-cache.js";
import { timelineWindowJsonLength } from "../../../src/services/threads/timeline-window-tag.js";

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
    extensionStates: {},
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

function built(rowCount: number) {
  return { expiresAt: null, response: makeResponse(rowCount) };
}

function windowBytes(rowCount: number): number {
  return timelineWindowJsonLength(makeResponse(rowCount));
}

const latestPage: ThreadTimelinePageRequest = {
  kind: "latest",
  segmentLimit: 20,
};

const baseKeyArgs: ThreadTimelineCacheKeyArgs = {
  threadId: "thr_x",
  page: latestPage,
  deferContent: false,
  includeNestedRows: false,
};

const baseRevisionArgs: ThreadTimelineCacheRevisionArgs = {
  maxSeq: 10,
  page: latestPage,
  rewriteGeneration: 0,
  status: "idle",
  surface: "surface-a",
};

const olderPage: ThreadTimelinePageRequest = {
  kind: "older",
  segmentLimit: 20,
  beforeCursor: { anchorSeq: 4, anchorId: "a4" },
};

describe("createThreadTimelineCache", () => {
  it("builds once for the same key and serves cached on repeat", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => built(3));

    const first = cache.getOrBuild("thr_x", "k", "r10", build);
    const second = cache.getOrBuild("thr_x", "k", "r10", build);

    expect(build).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("drops the stale revision and skips caching above the entry byte limit", () => {
    const cache = createThreadTimelineCache({ maxEntryBytes: windowBytes(5) });
    cache.getOrBuild("thr_x", "k", "r9", () => built(1));
    const build = vi.fn(() => built(50));

    cache.getOrBuild("thr_x", "k", "r10", build);
    cache.getOrBuild("thr_x", "k", "r10", build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it("caches a multi-megabyte window by default", () => {
    const cache = createThreadTimelineCache();
    const rowCount = Math.ceil(
      (3 * 1024 * 1024) / (windowBytes(2) - windowBytes(1)),
    );
    const build = vi.fn(() => built(rowCount));

    const first = cache.getOrBuild("thr_x", "k", "r10", build);

    expect(timelineWindowJsonLength(first)).toBeGreaterThan(3 * 1024 * 1024);
    expect(cache.getOrBuild("thr_x", "k", "r10", build)).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("caches windows with many rows when they fit the byte limit", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => built(500));

    const first = cache.getOrBuild("thr_x", "k", "r10", build);

    expect(cache.getOrBuild("thr_x", "k", "r10", build)).toBe(first);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("evicts least-recently-used entries beyond the byte budget", () => {
    const cache = createThreadTimelineCache({
      maxBytes: Math.floor(windowBytes(10) * 2.5),
    });
    const build = vi.fn(() => built(10));

    cache.getOrBuild("thr_x", "a", "r10", build);
    cache.getOrBuild("thr_x", "b", "r10", build);
    cache.getOrBuild("thr_x", "a", "r10", build);
    cache.getOrBuild("thr_x", "c", "r10", build);

    expect(cache.size).toBe(2);
    const buildAgain = vi.fn(() => built(10));
    cache.getOrBuild("thr_x", "a", "r10", buildAgain);
    cache.getOrBuild("thr_x", "b", "r10", buildAgain);
    expect(buildAgain).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when the thread's maxSeq advances", () => {
    const cache = createThreadTimelineCache();
    const build = vi.fn(() => built(1));

    const first = cache.getOrBuild("thr_x", "k", "r10", build);
    const second = cache.getOrBuild("thr_x", "k", "r11", build);

    expect(build).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
    expect(cache.getOrBuild("thr_x", "k", "r11", build)).toBe(second);
    expect(cache.size).toBe(1);
  });

  it("replaces the entry when the thread's status or surface changes", () => {
    const cache = createThreadTimelineCache();
    const key = buildThreadTimelineCacheKey(baseKeyArgs);
    const build = vi.fn(() => built(1));
    const revisions = [
      baseRevisionArgs,
      { ...baseRevisionArgs, status: "active" as const },
      { ...baseRevisionArgs, status: "active" as const, surface: "renamed" },
    ];

    for (const revision of revisions) {
      cache.getOrBuild(
        "thr_x",
        key,
        buildThreadTimelineCacheRevision(revision),
        build,
      );
    }

    expect(build).toHaveBeenCalledTimes(3);
    expect(cache.size).toBe(1);
  });

  it("keeps an idle thread cached while another thread streams revisions", () => {
    const cache = createThreadTimelineCache({ maxBytes: windowBytes(1) * 2 });
    const idleBuild = vi.fn(() => built(1));
    const idle = cache.getOrBuild("thr_idle", "idle", "r7", idleBuild);

    for (let maxSeq = 1; maxSeq <= 20; maxSeq += 1) {
      cache.getOrBuild("thr_active", "active", `r${maxSeq}`, () => built(1));
    }

    expect(cache.getOrBuild("thr_idle", "idle", "r7", idleBuild)).toBe(idle);
    expect(idleBuild).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(2);
  });

  it("evicts least-recently-used entries beyond maxEntries", () => {
    const cache = createThreadTimelineCache({ maxEntries: 2 });
    const build = vi.fn(() => built(1));

    cache.getOrBuild("thr_x", "a", "r10", build);
    cache.getOrBuild("thr_x", "b", "r10", build);
    cache.getOrBuild("thr_x", "a", "r10", build);
    cache.getOrBuild("thr_x", "c", "r10", build);

    expect(cache.size).toBe(2);
    const buildAgain = vi.fn(() => built(1));
    cache.getOrBuild("thr_x", "a", "r10", buildAgain);
    cache.getOrBuild("thr_x", "b", "r10", buildAgain);
    expect(buildAgain).toHaveBeenCalledTimes(1);
  });

  it("invalidates only entries for the rewritten thread", () => {
    const cache = createThreadTimelineCache({ maxBytes: windowBytes(1) * 2 });
    const build = vi.fn(() => built(1));
    cache.getOrBuild("thr_x", "x", "r10", build);
    cache.getOrBuild("thr_y", "y", "r10", build);

    for (let rewrite = 0; rewrite < 5; rewrite += 1) {
      cache.invalidateThread("thr_x");
      cache.getOrBuild("thr_x", "x", "r10", build);
    }

    cache.getOrBuild("thr_y", "y", "r10", build);
    expect(build).toHaveBeenCalledTimes(7);
    expect(cache.size).toBe(2);
  });
});

describe("buildThreadTimelineCacheKey", () => {
  it("differs when any request input differs", () => {
    const base = buildThreadTimelineCacheKey(baseKeyArgs);
    const variants: ThreadTimelineCacheKeyArgs[] = [
      { ...baseKeyArgs, threadId: "thr_y" },
      { ...baseKeyArgs, deferContent: true },
      { ...baseKeyArgs, includeNestedRows: true },
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

describe("buildThreadTimelineCacheRevision", () => {
  it("differs when any thread-state input differs", () => {
    const base = buildThreadTimelineCacheRevision(baseRevisionArgs);
    const variants: ThreadTimelineCacheRevisionArgs[] = [
      { ...baseRevisionArgs, maxSeq: 11 },
      { ...baseRevisionArgs, rewriteGeneration: 1 },
      { ...baseRevisionArgs, status: "active" },
      { ...baseRevisionArgs, surface: "surface-b" },
    ];
    for (const variant of variants) {
      expect(buildThreadTimelineCacheRevision(variant)).not.toBe(base);
    }
  });

  it("keys older pages on their cursor snapshot, not on the thread head", () => {
    const older = { ...baseRevisionArgs, page: olderPage };
    const base = buildThreadTimelineCacheRevision(older);
    expect(
      buildThreadTimelineCacheRevision({
        ...older,
        maxSeq: 99,
        status: "active",
      }),
    ).toBe(base);
    expect(
      buildThreadTimelineCacheRevision({ ...older, rewriteGeneration: 1 }),
    ).not.toBe(base);
    expect(
      buildThreadTimelineCacheRevision({ ...older, surface: "surface-b" }),
    ).not.toBe(base);
  });
});
