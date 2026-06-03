import { describe, expect, it, vi } from "vitest";
import type { ThreadTimelinePendingTodos } from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";

import {
  fetchThreadPendingTodos,
  type PendingTodosSdk,
  printPendingTodos,
} from "./pending-todos.js";

function captureLogLines(fn: () => void): { lines: string[] } {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    fn();
    const lines: string[] = [];
    for (const call of spy.mock.calls) {
      lines.push(String(call[0] ?? ""));
    }
    return { lines };
  } finally {
    spy.mockRestore();
  }
}

describe("printPendingTodos", () => {
  it("prints nothing when pendingTodos is null", () => {
    const { lines } = captureLogLines(() => printPendingTodos(null));
    expect(lines).toEqual([]);
  });

  it("prints nothing when items is empty (observed-empty snapshot)", () => {
    const snapshot: ThreadTimelinePendingTodos = {
      sourceSeq: 1,
      updatedAt: 1,
      items: [],
    };
    const { lines } = captureLogLines(() => printPendingTodos(snapshot));
    expect(lines).toEqual([]);
  });

  it("renders count-only heading when no items are completed", () => {
    const snapshot: ThreadTimelinePendingTodos = {
      sourceSeq: 1,
      updatedAt: 1,
      items: [
        { id: "a", text: "Investigate bug", status: "in_progress" },
        { id: "b", text: "Write fix", status: "pending" },
        { id: "c", text: "Add regression test", status: "pending" },
      ],
    };
    const { lines } = captureLogLines(() => printPendingTodos(snapshot));
    expect(lines).toEqual([
      "",
      "TODOs (3):",
      "  [>] Investigate bug",
      "  [ ] Write fix",
      "  [ ] Add regression test",
    ]);
  });

  it("renders fraction heading and orders in-progress before pending before completed", () => {
    const snapshot: ThreadTimelinePendingTodos = {
      sourceSeq: 1,
      updatedAt: 1,
      items: [
        { id: "a", text: "First done", status: "completed" },
        { id: "b", text: "Active work", status: "in_progress" },
        { id: "c", text: "Queued work", status: "pending" },
        { id: "d", text: "Second done", status: "completed" },
      ],
    };
    const { lines } = captureLogLines(() => printPendingTodos(snapshot));
    expect(lines).toEqual([
      "",
      "TODOs (2/4 done):",
      "  [>] Active work",
      "  [ ] Queued work",
      "  [x] First done",
      "  [x] Second done",
    ]);
  });

  it("keeps the section visible when every item is completed (mirrors UI)", () => {
    const snapshot: ThreadTimelinePendingTodos = {
      sourceSeq: 1,
      updatedAt: 1,
      items: [
        { id: "a", text: "Read planning doc", status: "completed" },
        { id: "b", text: "Build banner", status: "completed" },
      ],
    };
    const { lines } = captureLogLines(() => printPendingTodos(snapshot));
    expect(lines).toEqual([
      "",
      "TODOs (2/2 done):",
      "  [x] Read planning doc",
      "  [x] Build banner",
    ]);
  });
});

describe("fetchThreadPendingTodos", () => {
  function makeTimelineResponse(
    pendingTodos: ThreadTimelinePendingTodos | null,
  ): ThreadTimelineResponse {
    return {
      activeThinking: null,
      pendingTodos,
      rows: [],
      timelinePage: {
        kind: "latest",
        segmentLimit: 20,
        returnedSegmentCount: 0,
        hasOlderRows: false,
        olderCursor: null,
      },
    };
  }

  function makeSdkWithTimeline(
    handler: () => Promise<ThreadTimelineResponse>,
  ): PendingTodosSdk {
    return {
      threads: {
        timeline: vi.fn(handler),
      },
    };
  }

  it("returns the pendingTodos field from a successful timeline response", async () => {
    const snapshot: ThreadTimelinePendingTodos = {
      sourceSeq: 7,
      updatedAt: 7,
      items: [{ id: "a", text: "Work", status: "in_progress" }],
    };
    const sdk = makeSdkWithTimeline(async () => makeTimelineResponse(snapshot));
    const result = await fetchThreadPendingTodos({
      sdk,
      threadId: "thread-1",
    });
    expect(result).toEqual(snapshot);
  });

  it("returns null when the timeline call rejects (best-effort contract)", async () => {
    const sdk = makeSdkWithTimeline(async () => {
      throw new Error("network down");
    });
    const result = await fetchThreadPendingTodos({
      sdk,
      threadId: "thread-1",
    });
    expect(result).toBeNull();
  });
});
