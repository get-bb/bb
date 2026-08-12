import { describe, expect, it } from "vitest";
import type {
  ThreadTimelineResponse,
  TimelineCommandWorkRow,
  TimelinePaginationCursor,
  TimelineRow,
  TimelineTurnRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import {
  mergeLoadedTimelineWithLatest,
  mergeLatestTimelineRows,
  prependOlderTimelineRows,
  recoverLoadedTimelineAfterStaleCursor,
  type LoadedTimelineState,
} from "./useThreadTimelineController";

interface TimelineTestRowArgs {
  id: string;
  sequence: number;
}

interface TimelineTurnTestRowArgs extends TimelineTestRowArgs {
  children?: TimelineRow[];
}

function timelineCursor(args: TimelineTestRowArgs): TimelinePaginationCursor {
  return {
    anchorSeq: args.sequence,
    anchorId: args.id,
  };
}

function userRow(args: TimelineTestRowArgs): TimelineUserConversationRow {
  return {
    id: args.id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.sequence,
    sourceSeqEnd: args.sequence,
    startedAt: args.sequence,
    createdAt: args.sequence,
    kind: "conversation",
    role: "user",
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    text: args.id,
    mentions: [],
    attachments: null,
    turnRequest: { isGrouped: false, kind: "message", status: "accepted" },
  };
}

function commandRow(args: TimelineTestRowArgs): TimelineCommandWorkRow {
  return {
    id: args.id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.sequence,
    sourceSeqEnd: args.sequence,
    startedAt: args.sequence,
    createdAt: args.sequence,
    kind: "work",
    workKind: "command",
    status: "completed",
    callId: args.id,
    command: "pnpm test",
    cwd: null,
    source: null,
    output: "",
    exitCode: 0,
    completedAt: args.sequence,
    approvalStatus: null,
    activityIntents: [],
  };
}

function turnSummaryRow(args: TimelineTurnTestRowArgs): TimelineTurnRow {
  return {
    id: args.id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.sequence,
    sourceSeqEnd: args.sequence,
    startedAt: args.sequence,
    createdAt: args.sequence,
    kind: "turn",
    status: "completed",
    summaryCount: 1,
    completedAt: args.sequence,
    children: args.children ?? null,
  };
}

function makeTimelineResponse(
  rows: TimelineRow[],
  olderCursor: TimelinePaginationCursor | null,
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
    maxSeq: 0,
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
  rows: TimelineRow[],
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

    expect(rows.map((row) => row.id)).toEqual([
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

    expect(rows.map((row) => row.id)).toEqual([
      "first-user",
      "worked-for-summary",
      "latest-user",
    ]);
  });

  it("keeps distinct byte-budget slices of one finished turn", () => {
    const olderCommands = [
      commandRow({ id: "command-1", sequence: 10 }),
      commandRow({ id: "command-2", sequence: 11 }),
    ];
    const latestCommands = [
      commandRow({ id: "command-3", sequence: 20 }),
      commandRow({ id: "command-4", sequence: 21 }),
    ];
    const olderSlice = turnSummaryRow({
      id: "turn-1:sequence-page:10",
      sequence: 10,
      children: olderCommands,
    });
    const latestSlice = turnSummaryRow({
      id: "turn-1:sequence-page:20",
      sequence: 20,
      children: latestCommands,
    });

    const rows = prependOlderTimelineRows({
      olderRows: [olderSlice],
      loadedRows: [latestSlice],
    });

    expect(rows.map((row) => row.id)).toEqual([
      "turn-1:sequence-page:10",
      "turn-1:sequence-page:20",
    ]);
    expect(
      rows.flatMap((row) =>
        row.kind === "turn" && row.children !== null
          ? row.children.map((child) => child.id)
          : [],
      ),
    ).toEqual(["command-1", "command-2", "command-3", "command-4"]);
  });

  it("replaces a byte-cut latest page while an unfinished turn grows", () => {
    const loadedRows = [15, 16, 17, 18].map((sequence) =>
      commandRow({
        id: `command-${sequence}`,
        sequence,
      }),
    );
    const latestRows = [15, 16, 17, 18, 19, 20].map((sequence) =>
      commandRow({
        id: `command-${sequence}`,
        sequence,
      }),
    );

    const merge = mergeLatestTimelineRows({ loadedRows, latestRows });
    const callIds = merge.rows.flatMap((row) =>
      row.kind === "work" && row.workKind === "command" ? [row.callId] : [],
    );

    expect(merge.hasLatestOverlap).toBe(true);
    expect(merge.rows).toHaveLength(6);
    expect(new Set(callIds).size).toBe(6);
  });

  it("replaces the overlapping latest tail while preserving loaded history", () => {
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const oldTail = userRow({ id: "live-tail", sequence: 20 });
    const updatedTail = {
      ...oldTail,
      sourceSeqEnd: oldTail.sourceSeqEnd + 1,
      text: "updated tail",
    };
    const newStreamingRow = commandRow({
      id: "new-streaming-row",
      sequence: 21,
    });

    const merge = mergeLatestTimelineRows({
      loadedRows: [olderUser, oldTail],
      latestRows: [updatedTail, newStreamingRow],
    });

    expect(merge.rows.map((row) => row.id)).toEqual([
      "older-user",
      "live-tail",
      "new-streaming-row",
    ]);
    expect(merge.rows[1]).toMatchObject({ text: "updated tail" });
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
    const updatedTail = {
      ...oldTail,
      sourceSeqEnd: oldTail.sourceSeqEnd + 1,
      text: "updated tail",
    };

    const merge = mergeLatestTimelineRows({
      loadedRows: [olderUser, oldTail],
      latestRows: [updatedTail],
    });

    expect(merge.rows).toHaveLength(2);
    expect(merge.rows[0]).toBe(olderUser);
    expect(merge.rows[1]).toBe(updatedTail);
  });

  it("rebuilds when latest advances past the loaded rows with a gap between", () => {
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

    // Sequences 2..49 are in neither response. Keeping both and appending would
    // render them adjacent and leave `olderCursor` below the loaded rows, so the
    // hidden stretch could never be scrolled to. The fresh window replaces the
    // stale one instead, and its cursor pages back through the gap.
    expect(next.rows.map((row) => row.id)).toEqual(["latest"]);
    expect(next.olderCursor).toEqual(latestCursor);
  });

  it("keeps loaded rows when the latest window abuts them without overlapping", () => {
    const oldestCursor = timelineCursor({ id: "oldest", sequence: 1 });
    const current = makeLoadedTimelineState(
      [userRow({ id: "oldest", sequence: 1 })],
      oldestCursor,
    );
    const latestTimeline = makeTimelineResponse(
      [userRow({ id: "latest", sequence: 2 })],
      timelineCursor({ id: "latest-page", sequence: 2 }),
    );

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows.map((row) => row.id)).toEqual(["oldest", "latest"]);
    expect(next.olderCursor).toEqual(oldestCursor);
  });

  it("rebuilds when a finished turn reaches back past the loaded in-turn rows", () => {
    // Watching a long turn mid-flight loads rows cut at the budget floor, with
    // no user message above them. When the turn finishes it collapses into one
    // summary row spanning the whole turn, so the next latest response starts at
    // the turn's user message — before everything held. Splicing the two would
    // put the prompt after the work it produced.
    const inTurnCursor = timelineCursor({
      id: "thread-1:in-turn:500",
      sequence: 500,
    });
    const liveTail = commandRow({ id: "live-tail", sequence: 520 });
    const current = makeLoadedTimelineState(
      [commandRow({ id: "live-work", sequence: 500 }), liveTail],
      inTurnCursor,
    );
    const finishedCursor = timelineCursor({ id: "older-turn", sequence: 1 });
    const latestTimeline = makeTimelineResponse(
      [
        userRow({ id: "turn-prompt", sequence: 10 }),
        turnSummaryRow({ id: "turn-summary", sequence: 11 }),
        liveTail,
      ],
      finishedCursor,
    );

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows.map((row) => row.id)).toEqual([
      "turn-prompt",
      "turn-summary",
      "live-tail",
    ]);
    expect(next.olderCursor).toEqual(finishedCursor);
  });

  it("recovers from a stale cursor with a fresh latest cursor without dropping loaded rows", () => {
    const staleCursor = timelineCursor({ id: "stale-cursor", sequence: 1 });
    const freshCursor = timelineCursor({ id: "fresh-cursor", sequence: 40 });
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const oldTail = userRow({ id: "live-tail", sequence: 20 });
    const updatedTail = {
      ...oldTail,
      sourceSeqEnd: oldTail.sourceSeqEnd + 1,
      text: "updated tail",
    };
    const latestTimeline = makeTimelineResponse([updatedTail], freshCursor);

    const next = recoverLoadedTimelineAfterStaleCursor({
      current: makeLoadedTimelineState([olderUser, oldTail], staleCursor),
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows.map((row) => row.id)).toEqual(["older-user", "live-tail"]);
    expect(next.rows[1]).toMatchObject({ text: "updated tail" });
    expect(next.olderCursor).toEqual(freshCursor);
  });
});
