import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import {
  fetchThreadTimelineWindow,
  type TimelineWindowFetchArgs,
} from "./timeline-fetch";

function assistantRow(id: string, seq: number, text: string): TimelineRow {
  return {
    kind: "conversation",
    role: "assistant",
    id,
    threadId: "t1",
    turnId: "turn-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    startedAt: seq,
    createdAt: seq,
    text,
    attachments: null,
    turnRequest: null,
  };
}

function timeline(
  rows: TimelineRow[],
  maxSeq: number,
  extra: Partial<ThreadTimelineResponse> = {},
): ThreadTimelineResponse {
  return {
    rows,
    activePromptMode: null,
    activeThinking: null,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    pendingTodos: null,
    goal: null,
    modelFallback: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 50,
      returnedSegmentCount: rows.length,
      hasOlderRows: false,
      olderCursor: null,
    },
    maxSeq,
    ...extra,
  };
}

describe("fetchThreadTimelineWindow", () => {
  it("asks for a delta against the cached window and applies it in place", async () => {
    const previous = timeline(
      [assistantRow("a", 1, "one"), assistantRow("b", 2, "two")],
      2,
    );
    const fetchTimeline = vi.fn(async (args: TimelineWindowFetchArgs) => {
      expect(args).toEqual({ threadId: "t1", afterSequence: "2" });
      return timeline([], 3, {
        delta: {
          upsertRows: [assistantRow("b", 2, "two (final)")],
          rowOrder: ["a", "b", "c"].slice(0, 2),
        },
      });
    });

    const result = await fetchThreadTimelineWindow({
      fetchTimeline,
      previous,
      threadId: "t1",
    });

    expect(fetchTimeline).toHaveBeenCalledTimes(1);
    expect(result.delta).toBeUndefined();
    expect(result.maxSeq).toBe(3);
    // Unchanged rows keep identity; the upserted row is replaced.
    expect(result.rows[0]).toBe(previous.rows[0]);
    expect(result.rows[1]).toMatchObject({ id: "b", text: "two (final)" });
  });

  it("fetches the full window when there is no cached base", async () => {
    const full = timeline([assistantRow("a", 1, "one")], 1);
    const fetchTimeline = vi.fn(async (args: TimelineWindowFetchArgs) => {
      expect(args.afterSequence).toBeUndefined();
      return full;
    });
    const result = await fetchThreadTimelineWindow({
      fetchTimeline,
      previous: undefined,
      threadId: "t1",
    });
    expect(result).toBe(full);
  });

  it("falls back to a full fetch when the delta references a row we do not hold", async () => {
    const previous = timeline([assistantRow("a", 1, "one")], 1);
    const full = timeline(
      [assistantRow("a", 1, "one"), assistantRow("z", 5, "rebuilt")],
      5,
    );
    const fetchTimeline = vi.fn(async (args: TimelineWindowFetchArgs) => {
      if (args.afterSequence === "1") {
        return timeline([], 5, {
          delta: { upsertRows: [], rowOrder: ["a", "z"] },
        });
      }
      return full;
    });
    const result = await fetchThreadTimelineWindow({
      fetchTimeline,
      previous,
      threadId: "t1",
    });
    expect(fetchTimeline).toHaveBeenCalledTimes(2);
    expect(fetchTimeline.mock.calls[1]?.[0]).toEqual({ threadId: "t1" });
    expect(result).toBe(full);
  });

  it("passes the full-window response through untouched", async () => {
    const previous = timeline([assistantRow("a", 1, "one")], 1);
    const full = timeline([assistantRow("a", 1, "one")], 4);
    const result = await fetchThreadTimelineWindow({
      fetchTimeline: async () => full,
      previous,
      threadId: "t1",
    });
    expect(result).toBe(full);
  });
});
