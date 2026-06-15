import { describe, expect, it } from "vitest";
import type {
  ThreadTimelineFeedResponse,
  TimelineFeedRow,
  TimelinePaginationCursor,
} from "@bb/server-contract";
import {
  mergeLoadedTimelineWithLatest,
  mergeLatestTimelineRows,
  prependOlderTimelineRows,
  recoverLoadedTimelineAfterStaleCursor,
  type LoadedTimelineState,
} from "./useThreadTimelinePages";

interface TimelineTestRowArgs {
  id: string;
  sequence: number;
}

function timelineCursor(args: TimelineTestRowArgs): TimelinePaginationCursor {
  return {
    anchorSeq: args.sequence,
    anchorId: args.id,
  };
}

function userRow(args: TimelineTestRowArgs): TimelineFeedRow {
  return {
    key: args.id,
    turnId: "turn-1",
    source: {
      start: args.sequence,
      end: args.sequence,
    },
    startedAt: args.sequence,
    createdAt: args.sequence,
    detail: null,
    kind: "conversation",
    role: "user",
    initiator: "user",
    senderThreadId: null,
    textPreview: {
      text: args.id,
      fullLength: args.id.length,
      complete: true,
    },
    mentions: [],
    attachments: null,
    turnRequest: { kind: "message", status: "accepted" },
  };
}

function commandRow(args: TimelineTestRowArgs): TimelineFeedRow {
  return {
    key: args.id,
    turnId: "turn-1",
    source: {
      start: args.sequence,
      end: args.sequence,
    },
    startedAt: args.sequence,
    createdAt: args.sequence,
    detail: null,
    kind: "work",
    workKind: "command",
    status: "completed",
    callId: args.id,
    command: "pnpm test",
    cwd: null,
    sourceLabel: null,
    outputPreview: {
      text: "",
      fullLength: 0,
      complete: true,
    },
    exitCode: 0,
    completedAt: args.sequence,
    approvalStatus: null,
    activityIntents: [],
  };
}

function turnSummaryRow(args: TimelineTestRowArgs): TimelineFeedRow {
  return {
    key: args.id,
    turnId: "turn-1",
    source: {
      start: args.sequence,
      end: args.sequence,
    },
    startedAt: args.sequence,
    createdAt: args.sequence,
    detail: null,
    kind: "turn",
    status: "completed",
    summaryCount: 1,
    completedAt: args.sequence,
    children: null,
  };
}

function updateConversationRowText(
  row: TimelineFeedRow,
  text: string,
): TimelineFeedRow {
  if (row.kind !== "conversation") {
    return row;
  }
  return {
    ...row,
    textPreview: {
      text,
      fullLength: text.length,
      complete: true,
    },
  };
}

function updateTimelineRowSourceEnd(
  row: TimelineFeedRow,
  sourceEnd: number,
): TimelineFeedRow {
  return {
    ...row,
    source: {
      ...row.source,
      end: sourceEnd,
    },
  };
}

function makeTimelineResponse(
  rows: TimelineFeedRow[],
  olderCursor: TimelinePaginationCursor | null,
): ThreadTimelineFeedResponse {
  return {
    threadId: "thread-1",
    rows,
    activeThinking: null,
    pendingTodos: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: rows.length > 0 ? 1 : 0,
      hasOlderRows: olderCursor !== null,
      olderCursor,
    },
  };
}

function makeLoadedTimelineState(
  rows: TimelineFeedRow[],
  olderCursor: TimelinePaginationCursor | null,
): LoadedTimelineState {
  return {
    rows,
    olderCursor,
    surfaceKey: "thread-1:default",
  };
}

describe("timeline page row merging", () => {
  it("prepends older server-ordered rows without sorting by source sequence", () => {
    const olderUser = userRow({ id: "older-user", sequence: 10 });
    const olderCommand = commandRow({ id: "older-command", sequence: 1 });
    const latestUser = userRow({ id: "latest-user", sequence: 20 });

    const rows = prependOlderTimelineRows({
      olderRows: [olderUser, olderCommand],
      loadedRows: [latestUser],
    });

    expect(rows.map((row) => row.key)).toEqual([
      "older-user",
      "older-command",
      "latest-user",
    ]);
  });

  it("keeps server-ordered worked-for rows after the first user when their source sequence sorts earlier", () => {
    const firstUser = userRow({ id: "first-user", sequence: 10 });
    const workedForSummary = turnSummaryRow({
      id: "worked-for-summary",
      sequence: 1,
    });
    const latestUser = userRow({ id: "latest-user", sequence: 20 });

    const rows = prependOlderTimelineRows({
      olderRows: [firstUser, workedForSummary],
      loadedRows: [latestUser],
    });

    expect(rows.map((row) => row.key)).toEqual([
      "first-user",
      "worked-for-summary",
      "latest-user",
    ]);
  });

  it("replaces the overlapping latest tail while preserving loaded history", () => {
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const oldTail = userRow({ id: "live-tail", sequence: 20 });
    const updatedTail = updateConversationRowText(oldTail, "updated tail");
    const newStreamingRow = commandRow({
      id: "new-streaming-row",
      sequence: 21,
    });

    const merge = mergeLatestTimelineRows({
      loadedRows: [olderUser, oldTail],
      latestRows: [updatedTail, newStreamingRow],
    });

    expect(merge.rows.map((row) => row.key)).toEqual([
      "older-user",
      "live-tail",
      "new-streaming-row",
    ]);
    expect(merge.rows[1]).toMatchObject({
      textPreview: { text: "updated tail" },
    });
  });

  it("preserves unchanged overlapping row references after a latest refetch", () => {
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const oldTail = userRow({ id: "live-tail", sequence: 20 });
    const loadedRows = [olderUser, oldTail];
    const refetchedTail = { ...oldTail };

    const merge = mergeLatestTimelineRows({
      loadedRows,
      latestRows: [refetchedTail],
    });

    expect(merge.rows).toHaveLength(2);
    expect(merge.rows).toBe(loadedRows);
    expect(merge.rows[0]).toBe(olderUser);
    expect(merge.rows[1]).toBe(oldTail);
  });

  it("replaces changed overlapping row references after a latest refetch", () => {
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const oldTail = userRow({ id: "live-tail", sequence: 20 });
    const updatedTail = updateConversationRowText(
      updateTimelineRowSourceEnd(oldTail, oldTail.source.end + 1),
      "updated tail",
    );

    const merge = mergeLatestTimelineRows({
      loadedRows: [olderUser, oldTail],
      latestRows: [updatedTail],
    });

    expect(merge.rows).toHaveLength(2);
    expect(merge.rows[0]).toBe(olderUser);
    expect(merge.rows[1]).toBe(updatedTail);
  });

  it("resets to a pageable latest window when latest advances without overlap", () => {
    const oldestCursor = timelineCursor({ id: "oldest", sequence: 1 });
    const latestCursor = timelineCursor({ id: "latest-page", sequence: 40 });
    const current = makeLoadedTimelineState(
      [userRow({ id: "oldest", sequence: 1 })],
      oldestCursor,
    );
    const latestTimeline = makeTimelineResponse(
      [userRow({ id: "latest", sequence: 50 })],
      latestCursor,
    );

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows.map((row) => row.key)).toEqual(["latest"]);
    expect(next.olderCursor).toEqual(latestCursor);
  });

  it("recovers from a stale cursor with a fresh latest cursor without dropping loaded rows", () => {
    const staleCursor = timelineCursor({ id: "stale-cursor", sequence: 1 });
    const freshCursor = timelineCursor({ id: "fresh-cursor", sequence: 40 });
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const oldTail = userRow({ id: "live-tail", sequence: 20 });
    const updatedTail = updateConversationRowText(oldTail, "updated tail");
    const latestTimeline = makeTimelineResponse([updatedTail], freshCursor);

    const next = recoverLoadedTimelineAfterStaleCursor({
      current: makeLoadedTimelineState([olderUser, oldTail], staleCursor),
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows.map((row) => row.key)).toEqual([
      "older-user",
      "live-tail",
    ]);
    expect(next.rows[1]).toMatchObject({
      textPreview: { text: "updated tail" },
    });
    expect(next.olderCursor).toEqual(freshCursor);
  });
});
