import { describe, expect, it } from "vitest";
import type { TimelineFeedRow } from "@bb/server-contract";
import {
  createTimelineFeedViewRowsCache,
  mapTimelineFeedRowsToViewRows,
} from "../src/timeline-feed-view.js";

interface FeedRowArgs {
  id: string;
  sequence: number;
}

interface ConversationFeedRowArgs extends FeedRowArgs {
  text?: string;
}

interface TurnFeedRowArgs extends FeedRowArgs {
  children: TimelineFeedRow[];
}

function conversationRow({
  id,
  sequence,
  text = id,
}: ConversationFeedRowArgs): TimelineFeedRow {
  return {
    key: id,
    kind: "conversation",
    turnId: "turn-1",
    source: {
      start: sequence,
      end: sequence,
    },
    startedAt: sequence,
    createdAt: sequence,
    detail: null,
    role: "assistant",
    textPreview: {
      text,
      fullLength: text.length,
      complete: true,
    },
    attachments: null,
    turnRequest: null,
  };
}

function turnRow({
  id,
  sequence,
  children,
}: TurnFeedRowArgs): TimelineFeedRow {
  return {
    key: id,
    kind: "turn",
    turnId: id,
    source: {
      start: sequence,
      end: sequence,
    },
    startedAt: sequence,
    createdAt: sequence,
    detail: null,
    status: "completed",
    summaryCount: children.length,
    completedAt: sequence,
    children,
  };
}

describe("mapTimelineFeedRowsToViewRows", () => {
  it("reuses view-row identity for stable feed-row references", () => {
    const cache = createTimelineFeedViewRowsCache();
    const stableRow = conversationRow({ id: "stable", sequence: 1 });
    const changedRow = conversationRow({ id: "changed", sequence: 2 });
    const initialRows = mapTimelineFeedRowsToViewRows({
      cache,
      rows: [stableRow, changedRow],
      threadId: "thread-1",
    });

    const nextChangedRow = conversationRow({
      id: "changed",
      sequence: 2,
      text: "updated",
    });
    const nextRows = mapTimelineFeedRowsToViewRows({
      cache,
      rows: [stableRow, nextChangedRow],
      threadId: "thread-1",
    });

    expect(nextRows[0]).toBe(initialRows[0]);
    expect(nextRows[1]).not.toBe(initialRows[1]);
    expect(nextRows[1]).toMatchObject({ text: "updated" });
  });

  it("reuses the same cache for recursive child rows", () => {
    const cache = createTimelineFeedViewRowsCache();
    const child = conversationRow({ id: "child", sequence: 2 });
    const initialRows = mapTimelineFeedRowsToViewRows({
      cache,
      rows: [turnRow({ id: "turn", sequence: 1, children: [child] })],
      threadId: "thread-1",
    });

    const nextRows = mapTimelineFeedRowsToViewRows({
      cache,
      rows: [turnRow({ id: "turn", sequence: 1, children: [child] })],
      threadId: "thread-1",
    });

    const initialTurn = initialRows[0];
    const nextTurn = nextRows[0];
    if (
      initialTurn?.kind !== "turn" ||
      initialTurn.children === null ||
      nextTurn?.kind !== "turn" ||
      nextTurn.children === null
    ) {
      throw new Error("Expected turn rows with loaded children");
    }

    expect(nextTurn).not.toBe(initialTurn);
    expect(nextTurn.children[0]).toBe(initialTurn.children[0]);
  });
});
