import { describe, expect, it, vi } from "vitest";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import { createThreadTimelineWindowCache } from "../../../src/services/threads/timeline-cache.js";
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
    pendingSteers: [],
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
  return { expiresAt: null, value: makeResponse(rowCount) };
}

function windowBytes(rowCount: number): number {
  return timelineWindowJsonLength(makeResponse(rowCount));
}

describe("createThreadTimelineWindowCache", () => {
  it("caches a multi-megabyte window", () => {
    const cache = createThreadTimelineWindowCache();
    const rowCount = Math.ceil(
      (3 * 1024 * 1024) / (windowBytes(2) - windowBytes(1)),
    );
    const read = {
      threadId: "thr_x",
      slot: "k",
      revision: "r10",
      build: vi.fn(() => built(rowCount)),
    };

    const first = cache.getOrBuild(read);

    expect(timelineWindowJsonLength(first)).toBeGreaterThan(3 * 1024 * 1024);
    expect(cache.getOrBuild(read)).toBe(first);
    expect(read.build).toHaveBeenCalledTimes(1);
  });
});
