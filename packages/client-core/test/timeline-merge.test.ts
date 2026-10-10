import { describe, expect, it } from "vitest";
import { applyTimelineDelta } from "@bb/server-contract";
import { OPTIMISTIC_TIMELINE_ROW_ID_PREFIX } from "../src/timeline/optimistic-timeline-row.js";
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
  prependOlderTimelineRows,
  recoverLoadedTimelineAfterStaleCursor,
  type LoadedTimelineState,
} from "../src/timeline/timeline-merge.js";

interface TimelineTestRowArgs {
  endSequence?: number;
  id: string;
  sequence: number;
  turnRequestStatus?: "accepted" | "pending" | "rejected";
}

interface TimelineTurnTestRowArgs extends TimelineTestRowArgs {
  children?: TimelineRow[];
  endSequence?: number;
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
    sourceSeqEnd: args.endSequence ?? args.sequence,
    messageSeq: args.endSequence ?? args.sequence,
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
    turnRequest: {
      isGrouped: false,
      kind: "message",
      status: args.turnRequestStatus ?? "accepted",
    },
  };
}

function commandRow(args: TimelineTestRowArgs): TimelineCommandWorkRow {
  return {
    id: args.id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: args.sequence,
    sourceSeqEnd: args.endSequence ?? args.sequence,
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
    sourceSeqEnd: args.endSequence ?? args.sequence,
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
  maxSeq = Math.max(
    olderCursor?.anchorSeq ?? 0,
    ...rows.map((row) => row.sourceSeqEnd),
  ),
): ThreadTimelineResponse {
  return {
    rows,
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
    maxSeq,
    timelinePage: {
      returnedSegmentCount: rows.length > 0 ? 1 : 0,
      olderCursor,
      historySnapshot: "snapshot-1",
      olderRowsSourceSeqEnd: null,
    },
  };
}

function makeLoadedTimelineState(
  rows: TimelineRow[],
  olderCursor: TimelinePaginationCursor | null,
  latestWindowEndSequence = Math.max(
    olderCursor?.anchorSeq ?? 0,
    ...rows.map((row) => row.sourceSeqEnd),
  ),
): LoadedTimelineState {
  return {
    historySnapshot: "snapshot-1",
    latestWindowEndSequence,
    rows,
    olderCursor,
    surfaceKey: "thread-1:default",
  };
}

interface MergeIntoScrolledBackViewArgs {
  latestRows: TimelineRow[];
  loadedEndSequence?: number;
  loadedRows: TimelineRow[];
  windowStart: number;
}

function mergeIntoScrolledBackView({
  latestRows,
  loadedEndSequence,
  loadedRows,
  windowStart,
}: MergeIntoScrolledBackViewArgs): LoadedTimelineState {
  const loadedEnd =
    loadedEndSequence ??
    Math.max(0, ...loadedRows.map((row) => row.sourceSeqEnd));
  const current = {
    ...makeLoadedTimelineState(
      loadedRows,
      timelineCursor({ id: "loaded-cursor", sequence: 0 }),
      loadedEnd,
    ),
    historySnapshot: `snapshot-${loadedEnd}`,
  };
  const latestTimeline = makeTimelineResponse(
    latestRows,
    windowStart === 0
      ? null
      : timelineCursor({ id: "latest-cursor", sequence: windowStart }),
    Math.max(loadedEnd, ...latestRows.map((row) => row.sourceSeqEnd)),
  );
  latestTimeline.timelinePage.historySnapshot = `snapshot-${latestTimeline.maxSeq}`;
  return mergeLoadedTimelineWithLatest({
    current,
    latestTimeline,
    surfaceKey: current.surfaceKey,
  });
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

    const next = mergeIntoScrolledBackView({
      latestRows,
      loadedRows,
      windowStart: 15,
    });
    const callIds = next.rows.flatMap((row) =>
      row.kind === "work" && row.workKind === "command" ? [row.callId] : [],
    );

    expect(next.rows).toHaveLength(6);
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

    const next = mergeIntoScrolledBackView({
      latestRows: [updatedTail, newStreamingRow],
      loadedRows: [olderUser, oldTail],
      windowStart: 20,
    });

    expect(next.rows.map((row) => row.id)).toEqual([
      "older-user",
      "live-tail",
      "new-streaming-row",
    ]);
    expect(next.rows[1]).toMatchObject({ text: "updated tail" });
  });
  it("retains every loaded row that ends before the latest window", () => {
    const prompt = userRow({ id: "prompt", sequence: 1 });
    const straddlingWork = commandRow({
      endSequence: 210,
      id: "straddling-work",
      sequence: 20,
    });
    const steer = userRow({ id: "accepted-steer", sequence: 100 });
    const olderWork = commandRow({ id: "older-work", sequence: 120 });
    const coveredStaleRow = commandRow({
      id: "covered-stale-row",
      sequence: 180,
    });
    const tail = commandRow({ id: "tail", sequence: 200 });
    const updatedStraddlingWork = {
      ...straddlingWork,
      sourceSeqEnd: 300,
      output: "updated straddling output",
    };
    const updatedTail = {
      ...tail,
      sourceSeqEnd: 300,
      output: "updated tail output",
    };
    const newTail = commandRow({ id: "new-tail", sequence: 250 });

    const next = mergeIntoScrolledBackView({
      latestRows: [updatedStraddlingWork, updatedTail, newTail],
      loadedRows: [
        prompt,
        straddlingWork,
        steer,
        olderWork,
        coveredStaleRow,
        tail,
      ],
      windowStart: 150,
    });

    expect(next.rows.map((row) => row.id)).toEqual([
      "prompt",
      "straddling-work",
      "accepted-steer",
      "older-work",
      "tail",
      "new-tail",
    ]);
    expect(next.rows[1]).toBe(updatedStraddlingWork);
    expect(next.rows[2]).toBe(steer);
    expect(next.rows[3]).toBe(olderWork);
    expect(next.rows[4]).toBe(updatedTail);
  });
  it("preserves unchanged overlapping row references after a latest refetch", () => {
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const oldTail = userRow({ id: "live-tail", sequence: 20 });
    const current = makeLoadedTimelineState(
      [olderUser, oldTail],
      timelineCursor({ id: "loaded-cursor", sequence: 0 }),
    );
    const latestTimeline = makeTimelineResponse(
      [{ ...oldTail }],
      timelineCursor({ id: "latest-cursor", sequence: 20 }),
    );

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows).toBe(current.rows);
    expect(next.olderCursor).toBe(current.olderCursor);
  });
  it("replaces a pending message row when the server accepts it", () => {
    const pendingMessage = userRow({
      id: "submitted-message",
      sequence: 1,
      turnRequestStatus: "pending",
    });
    const acceptedMessage = userRow({
      id: "submitted-message",
      sequence: 1,
      turnRequestStatus: "accepted",
    });

    const next = mergeIntoScrolledBackView({
      latestRows: [acceptedMessage],
      loadedRows: [pendingMessage],
      windowStart: 0,
    });

    expect(next.rows).toEqual([acceptedMessage]);
    expect(next.rows[0]).toBe(acceptedMessage);
  });

  it("replaces a retained optimistic row with the server row it stands in for", () => {
    const optimistic = userRow({
      id: `${OPTIMISTIC_TIMELINE_ROW_ID_PREFIX}a1`,
      sequence: 0,
    });
    const serverRow = userRow({ id: "thread-1:user-seed:5", sequence: 5 });

    const next = mergeIntoScrolledBackView({
      latestRows: [serverRow],
      loadedRows: [optimistic],
      windowStart: 0,
    });

    expect(next.rows.map((row) => row.id)).toEqual([serverRow.id]);
  });

  it("keeps a pending optimistic row that the latest snapshot still carries", () => {
    const optimistic = userRow({
      id: `${OPTIMISTIC_TIMELINE_ROW_ID_PREFIX}a1`,
      sequence: 0,
    });

    const next = mergeIntoScrolledBackView({
      latestRows: [optimistic],
      loadedRows: [optimistic],
      windowStart: 0,
    });

    expect(next.rows.map((row) => row.id)).toEqual([optimistic.id]);
  });

  it("appends a latest window that starts after the loaded tip", () => {
    const older = userRow({ id: "thread-1:user-seed:1", sequence: 1 });
    const newer = userRow({ id: "thread-1:user-seed:5", sequence: 5 });

    const next = mergeIntoScrolledBackView({
      latestRows: [newer],
      loadedEndSequence: 4,
      loadedRows: [older],
      windowStart: 5,
    });

    expect(next.rows.map((row) => row.id)).toEqual([older.id, newer.id]);
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

    expect(next.rows.map((row) => row.id)).toEqual(["latest"]);
    expect(next.olderCursor).toEqual(latestCursor);
  });

  it("rebuilds across a raw sequence gap even when a projected row overlaps", () => {
    const oldCursor = timelineCursor({ id: "old-page", sequence: 1 });
    const latestCursor = timelineCursor({ id: "latest-page", sequence: 150 });
    const straddlingWork = commandRow({
      endSequence: 100,
      id: "straddling-work",
      sequence: 20,
    });
    const updatedStraddlingWork = {
      ...straddlingWork,
      sourceSeqEnd: 300,
      output: "updated output",
    };
    const current = makeLoadedTimelineState([straddlingWork], oldCursor, 100);
    const latestTimeline = makeTimelineResponse(
      [updatedStraddlingWork],
      latestCursor,
      300,
    );

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows).toEqual([updatedStraddlingWork]);
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

  it("reconciles when a finished turn reaches back past loaded in-turn rows", () => {
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

  it("keeps loaded rows when unprojected events separate them from the follow-up window", () => {
    const oldestCursor = timelineCursor({ id: "oldest", sequence: 1 });
    const current = makeLoadedTimelineState(
      [
        userRow({ id: "oldest", sequence: 1 }),
        turnSummaryRow({ endSequence: 100, id: "turn-summary", sequence: 10 }),
        commandRow({ id: "late-error", sequence: 99 }),
      ],
      oldestCursor,
      100,
    );
    const latestTimeline = makeTimelineResponse(
      [userRow({ id: "follow-up", sequence: 101 })],
      timelineCursor({ id: "follow-up", sequence: 101 }),
      104,
    );

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows.map((row) => row.id)).toEqual([
      "oldest",
      "turn-summary",
      "late-error",
      "follow-up",
    ]);
    expect(next.olderCursor).toEqual(oldestCursor);
  });

  it("keeps loaded rows when a window's first row is backfilled from below the cut", () => {
    const inTurnCursor = timelineCursor({
      id: "thread-1:in-turn:60",
      sequence: 60,
    });
    const current = makeLoadedTimelineState(
      [commandRow({ id: "loaded-work", sequence: 40 })],
      timelineCursor({ id: "thread-1:in-turn:30", sequence: 30 }),
      59,
    );
    const latestTimeline = makeTimelineResponse(
      [
        turnSummaryRow({ endSequence: 70, id: "turn-summary", sequence: 20 }),
        commandRow({ id: "live-work", sequence: 65 }),
      ],
      inTurnCursor,
      70,
    );

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows.map((row) => row.id)).toEqual([
      "loaded-work",
      "turn-summary",
      "live-work",
    ]);
  });

  it("recovers from a stale cursor with a fresh latest cursor without dropping loaded rows", () => {
    const staleCursor = timelineCursor({ id: "stale-cursor", sequence: 1 });
    const freshCursor = timelineCursor({ id: "fresh-cursor", sequence: 20 });
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const tail = userRow({ id: "live-tail", sequence: 20 });
    const latestTimeline = makeTimelineResponse([tail], freshCursor);

    const next = recoverLoadedTimelineAfterStaleCursor({
      current: makeLoadedTimelineState([olderUser, tail], staleCursor),
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows.map((row) => row.id)).toEqual(["older-user", "live-tail"]);
    expect(next.olderCursor).toEqual(freshCursor);
  });

  it("recovers from a stale cursor under a new snapshot with the latest window alone", () => {
    const freshCursor = timelineCursor({ id: "fresh-cursor", sequence: 20 });
    const tail = userRow({ id: "live-tail", sequence: 20 });
    const latestTimeline = makeTimelineResponse([tail], freshCursor, 21);
    latestTimeline.timelinePage.historySnapshot = "snapshot-renamed";

    const next = recoverLoadedTimelineAfterStaleCursor({
      current: makeLoadedTimelineState(
        [userRow({ id: "older-user", sequence: 1 }), tail],
        timelineCursor({ id: "stale-cursor", sequence: 1 }),
      ),
      latestTimeline,
      surfaceKey: "thread-1:default",
    });

    expect(next.rows).toEqual([tail]);
    expect(next.olderCursor).toEqual(freshCursor);
    expect(next.historySnapshot).toBe("snapshot-renamed");
  });
});

describe("snapshot content pagination", () => {
  it("joins stable summary children and preserves them across an unchanged latest refresh", () => {
    const first = commandRow({ id: "first", sequence: 2 });
    const last = commandRow({ id: "last", sequence: 3 });
    const older = turnSummaryRow({
      id: "summary",
      sequence: 1,
      endSequence: 4,
      children: [first],
    });
    const latest = turnSummaryRow({
      id: "summary",
      sequence: 1,
      endSequence: 4,
      children: [last],
    });
    const rows = prependOlderTimelineRows({
      olderRows: [older],
      loadedRows: [latest],
    });
    expect(rows).toEqual([{ ...latest, children: [first, last] }]);
    const response = makeTimelineResponse(
      [latest],
      timelineCursor({ id: "contents", sequence: 1 }),
      4,
    );
    response.timelinePage.historySnapshot = "snapshot-1";
    const current = {
      ...makeLoadedTimelineState(rows, null, 4),
      historySnapshot: "snapshot-1",
    };
    expect(
      mergeLoadedTimelineWithLatest({
        current,
        latestTimeline: response,
        surfaceKey: current.surfaceKey,
      }).rows,
    ).toEqual(rows);
  });

  it("discards old grouping when a new snapshot arrives at the same sequence", () => {
    const current = {
      ...makeLoadedTimelineState(
        [userRow({ id: "old", sequence: 1 })],
        null,
        4,
      ),
      historySnapshot: "snapshot-1",
    };
    const latestTimeline = makeTimelineResponse(
      [userRow({ id: "replacement", sequence: 1 })],
      null,
      4,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-2";
    const result = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });
    expect(result.rows).toEqual(latestTimeline.rows);
    expect(result.historySnapshot).toBe("snapshot-2");
  });

  it("keeps loaded older pages when a streaming refresh advances the snapshot", () => {
    const walkCursor = timelineCursor({ id: "walk-cursor", sequence: 1 });
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const olderSummary = turnSummaryRow({
      id: "older-summary",
      sequence: 2,
      endSequence: 9,
    });
    const latestUser = userRow({ id: "latest-user", sequence: 10 });
    const streaming = commandRow({ id: "streaming", sequence: 11 });
    const current = {
      ...makeLoadedTimelineState(
        [olderUser, olderSummary, latestUser, streaming],
        walkCursor,
        11,
      ),
      historySnapshot: "snapshot-1",
    };
    const updatedStreaming = {
      ...streaming,
      sourceSeqEnd: 12,
      output: "more output",
    };
    const latestTimeline = makeTimelineResponse(
      [latestUser, updatedStreaming],
      timelineCursor({ id: "latest-cursor", sequence: 10 }),
      12,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-2";
    latestTimeline.timelinePage.olderRowsSourceSeqEnd = null;

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows).toEqual([
      olderUser,
      olderSummary,
      latestUser,
      updatedStreaming,
    ]);
    expect(next.olderCursor).toEqual(walkCursor);
    expect(next.historySnapshot).toBe("snapshot-2");
    expect(next.latestWindowEndSequence).toBe(12);
  });

  it("keeps the in-flight walk cursor when a refresh returns the same window start", () => {
    const firstCursor = timelineCursor({
      id: "snapshot-1-cursor",
      sequence: 10,
    });
    const latestUser = userRow({ id: "latest-user", sequence: 10 });
    const current = {
      ...makeLoadedTimelineState([latestUser], firstCursor, 10),
      historySnapshot: "snapshot-1",
    };
    const latestTimeline = makeTimelineResponse(
      [latestUser, commandRow({ id: "streaming", sequence: 11 })],
      timelineCursor({ id: "snapshot-2-cursor", sequence: 10 }),
      11,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-2";
    latestTimeline.timelinePage.olderRowsSourceSeqEnd = null;

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.olderCursor).toEqual(firstCursor);
    expect(next.rows.map((row) => row.id)).toEqual([
      "latest-user",
      "streaming",
    ]);
  });

  it("keeps the head of a running turn while its content-cut latest page slides forward", () => {
    const cursor = timelineCursor({ id: "turn-cursor-1", sequence: 10 });
    const prompt = userRow({ id: "prompt", sequence: 10 });
    const commands = [11, 12, 13, 14].map((sequence) =>
      commandRow({ id: `command-${sequence}`, sequence }),
    );
    const current = {
      ...makeLoadedTimelineState([prompt, ...commands.slice(0, 3)], cursor, 13),
      historySnapshot: "snapshot-1",
    };
    const latestTimeline = makeTimelineResponse(
      commands.slice(1),
      timelineCursor({ id: "turn-cursor-2", sequence: 10 }),
      14,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-2";
    latestTimeline.timelinePage.olderRowsSourceSeqEnd = 11;

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows.map((row) => row.id)).toEqual([
      "prompt",
      "command-11",
      "command-12",
      "command-13",
      "command-14",
    ]);
    expect(next.olderCursor).toEqual(cursor);
  });

  it("appends a new conversation group that starts right after the loaded tip", () => {
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const previousUser = userRow({ id: "previous-user", sequence: 10 });
    const walkCursor = timelineCursor({ id: "walk-cursor", sequence: 1 });
    const current = {
      ...makeLoadedTimelineState([olderUser, previousUser], walkCursor, 20),
      historySnapshot: "snapshot-1",
    };
    const followUp = userRow({ id: "follow-up", sequence: 21 });
    const latestTimeline = makeTimelineResponse(
      [followUp],
      timelineCursor({ id: "follow-up", sequence: 21 }),
      24,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-2";
    latestTimeline.timelinePage.olderRowsSourceSeqEnd = null;

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows.map((row) => row.id)).toEqual([
      "older-user",
      "previous-user",
      "follow-up",
    ]);
    expect(next.olderCursor).toEqual(walkCursor);
  });

  it("rebuilds when an advanced snapshot shares no rows with a window it overlaps", () => {
    const current = {
      ...makeLoadedTimelineState(
        [
          userRow({ id: "older-user", sequence: 1 }),
          userRow({ id: "regrouped", sequence: 10 }),
        ],
        timelineCursor({ id: "walk-cursor", sequence: 1 }),
        20,
      ),
      historySnapshot: "snapshot-1",
    };
    const latestCursor = timelineCursor({ id: "latest-cursor", sequence: 10 });
    const latestTimeline = makeTimelineResponse(
      [userRow({ id: "replacement", sequence: 10 })],
      latestCursor,
      24,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-2";
    latestTimeline.timelinePage.olderRowsSourceSeqEnd = null;

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows.map((row) => row.id)).toEqual(["replacement"]);
    expect(next.olderCursor).toEqual(latestCursor);
  });

  it("rebuilds when an event after the loaded tip changes an older conversation group", () => {
    const latestUser = userRow({ id: "latest-user", sequence: 10 });
    const current = {
      ...makeLoadedTimelineState(
        [userRow({ id: "older-user", sequence: 1 }), latestUser],
        timelineCursor({ id: "walk-cursor", sequence: 1 }),
        11,
      ),
      historySnapshot: "snapshot-1",
    };
    const latestCursor = timelineCursor({ id: "latest-cursor", sequence: 10 });
    const latestTimeline = makeTimelineResponse([latestUser], latestCursor, 12);
    latestTimeline.timelinePage.historySnapshot = "snapshot-2";
    latestTimeline.timelinePage.olderRowsSourceSeqEnd = 12;

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows.map((row) => row.id)).toEqual(["latest-user"]);
    expect(next.olderCursor).toEqual(latestCursor);
    expect(next.historySnapshot).toBe("snapshot-2");
  });

  it("keeps omitted-row updates through streaming and repeat refreshes", () => {
    const olderUser = userRow({ id: "older-user", sequence: 1 });
    const earlyChild = commandRow({ id: "early-command", sequence: 3 });
    const liveChild = commandRow({ id: "live-command", sequence: 4 });
    const summary = turnSummaryRow({
      id: "summary",
      sequence: 2,
      endSequence: 4,
      children: [earlyChild, liveChild],
    });
    const latestUser = userRow({ id: "latest-user", sequence: 10 });
    const walkCursor = timelineCursor({ id: "walk-cursor", sequence: 1 });
    const current = {
      ...makeLoadedTimelineState(
        [olderUser, summary, latestUser],
        walkCursor,
        11,
      ),
      historySnapshot: "snapshot-1",
    };
    const updatedChild = { ...liveChild, sourceSeqEnd: 12, output: "progress" };
    const newChild = commandRow({ id: "new-command", sequence: 12 });
    const latestTimeline = makeTimelineResponse(
      [latestUser],
      timelineCursor({ id: "latest-cursor", sequence: 10 }),
      12,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-2";
    latestTimeline.timelinePage.olderRowsSourceSeqEnd = 1;
    latestTimeline.timelinePage.olderRowUpdates = [
      { ...summary, sourceSeqEnd: 12, children: [updatedChild, newChild] },
      commandRow({ id: "unloaded", sequence: 5, endSequence: 12 }),
    ];

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    const expectedRows = [
      olderUser,
      {
        ...summary,
        sourceSeqEnd: 12,
        children: [earlyChild, updatedChild, newChild],
      },
      latestUser,
    ];
    expect(next.rows).toEqual(expectedRows);
    const refreshed = mergeLoadedTimelineWithLatest({
      current: next,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });
    expect(refreshed.rows).toEqual(expectedRows);
    expect(next.olderCursor).toEqual(walkCursor);
    expect(next.latestWindowEndSequence).toBe(12);
  });

  it("keeps loaded order when an older page repeats the loaded conversation group", () => {
    const providerEnvironment = commandRow({
      id: "provider-env",
      sequence: 15,
    });
    const user = userRow({ id: "user", sequence: 13 });
    const assistant = commandRow({ id: "assistant", sequence: 16 });
    const olderAssistant = commandRow({ id: "older-assistant", sequence: 5 });

    const rows = prependOlderTimelineRows({
      olderRows: [olderAssistant, user, assistant],
      loadedRows: [providerEnvironment, user, assistant],
    });

    expect(rows.map((row) => row.id)).toEqual([
      "older-assistant",
      "provider-env",
      "user",
      "assistant",
    ]);
    expect(rows[2]).toBe(user);
  });

  it("replaces changed content even when row identity and sequence are unchanged", () => {
    const old = commandRow({ id: "command", sequence: 2 });
    const updated = { ...old, output: "updated output" };
    expect(
      mergeIntoScrolledBackView({
        latestRows: [updated],
        loadedRows: [old],
        windowStart: 1,
      }).rows,
    ).toEqual([updated]);
  });

  it("drops in-window rows that a completed turn absorbed and restarts the walk at the window", () => {
    const loadedCursor = timelineCursor({ id: "in-turn-cursor", sequence: 8 });
    const commands = [9, 10, 11].map((sequence) =>
      commandRow({ id: `command-${sequence}`, sequence }),
    );
    const answer = userRow({ id: "answer", sequence: 12 });
    const current = {
      ...makeLoadedTimelineState([...commands, answer], loadedCursor, 12),
      historySnapshot: "snapshot-12",
    };
    const latestCursor = timelineCursor({ id: "turn-cursor", sequence: 8 });
    const latestTimeline = makeTimelineResponse(
      [
        userRow({ id: "prompt", sequence: 8 }),
        turnSummaryRow({ id: "summary", sequence: 8, endSequence: 13 }),
        answer,
      ],
      latestCursor,
      13,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-13";

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows.map((row) => row.id)).toEqual([
      "prompt",
      "summary",
      "answer",
    ]);
    expect(next.olderCursor).toBe(latestCursor);
  });

  it("keeps rows a content cut omitted when a refresh reports no updates for them", () => {
    const prompt = userRow({ id: "prompt", sequence: 10 });
    const commands = [11, 12, 13].map((sequence) =>
      commandRow({ id: `command-${sequence}`, sequence }),
    );
    const walkCursor = timelineCursor({ id: "walk-cursor", sequence: 1 });
    const current = {
      ...makeLoadedTimelineState([prompt, ...commands], walkCursor, 13),
      historySnapshot: "snapshot-13",
    };
    const latestTimeline = makeTimelineResponse(
      [commands[2]!],
      timelineCursor({ id: "content-cursor", sequence: 10 }),
      13,
    );
    latestTimeline.timelinePage.historySnapshot = "snapshot-13";
    latestTimeline.timelinePage.olderRowsSourceSeqEnd = 12;

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows).toBe(current.rows);
    expect(next.olderCursor).toBe(walkCursor);
  });
  it.each(["snapshot-1", "snapshot-2"])(
    "reuses delta row references without reading nested payloads under %s",
    (historySnapshot) => {
      let outputReads = 0;
      const child = commandRow({ id: "unchanged-command", sequence: 2 });
      Object.defineProperty(child, "output", {
        enumerable: true,
        get() {
          outputReads++;
          return "large unchanged tool output";
        },
      });
      const summary = turnSummaryRow({
        id: "summary",
        sequence: 2,
        children: [child],
      });
      const tail = commandRow({ id: "live-command", sequence: 3 });
      const updatedTail = { ...tail, output: "changed at the same sequence" };
      const current = {
        ...makeLoadedTimelineState([summary, tail], null),
        historySnapshot: "snapshot-1",
      };
      const rows = applyTimelineDelta(current.rows, {
        upsertRows: [updatedTail],
      });
      expect(rows).not.toBeNull();
      const latestTimeline = makeTimelineResponse(rows!, null);
      latestTimeline.timelinePage.historySnapshot = historySnapshot;
      latestTimeline.timelinePage.olderRowsSourceSeqEnd = null;

      const next = mergeLoadedTimelineWithLatest({
        current,
        latestTimeline,
        surfaceKey: current.surfaceKey,
      });

      expect(next.rows[0]).toBe(summary);
      expect(next.rows[1]).toBe(updatedTail);
      expect(outputReads).toBe(0);
    },
  );

  it("retains older children when a delta updates a partially loaded summary", () => {
    const olderChild = commandRow({ id: "older-command", sequence: 2 });
    const child = commandRow({ id: "live-command", sequence: 3 });
    const partial = turnSummaryRow({
      id: "summary",
      sequence: 2,
      endSequence: 3,
      children: [child],
    });
    const current = {
      ...makeLoadedTimelineState(
        [{ ...partial, children: [olderChild, child] }],
        null,
      ),
      historySnapshot: "snapshot-1",
    };
    const updatedChild = { ...child, output: "new output" };
    const updated = { ...partial, children: [updatedChild] };
    const rows = applyTimelineDelta([partial], { upsertRows: [updated] });
    expect(rows).not.toBeNull();
    const latestTimeline = makeTimelineResponse(rows!, null);
    latestTimeline.timelinePage.historySnapshot = current.historySnapshot;

    const next = mergeLoadedTimelineWithLatest({
      current,
      latestTimeline,
      surfaceKey: current.surfaceKey,
    });

    expect(next.rows).toEqual([
      { ...updated, children: [olderChild, updatedChild] },
    ]);
  });

  it("still deduplicates children when both pages contain the same summary object", () => {
    const child = commandRow({ id: "repeated-command", sequence: 2 });
    const summary = turnSummaryRow({
      id: "summary",
      sequence: 2,
      children: [child, child],
    });

    expect(
      prependOlderTimelineRows({
        olderRows: [summary],
        loadedRows: [summary],
      }),
    ).toEqual([{ ...summary, children: [child] }]);
  });
});
