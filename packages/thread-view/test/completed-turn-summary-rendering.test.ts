import type { TimelineRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";
import type { TimelineEventFactory } from "./timeline-test-harness.js";

type TimelineFixtureEvent = ReturnType<
  TimelineEventFactory[keyof TimelineEventFactory]
>;
type TimelineTurnRow = Extract<TimelineRow, { kind: "turn" }>;
type TimelineWorkRow = Extract<TimelineRow, { kind: "work" }>;

interface RenderCompletedTimelineArgs {
  events: TimelineFixtureEvent[];
  includeDebugRawEvents?: boolean;
}

function renderCompletedTimeline(args: RenderCompletedTimelineArgs) {
  return renderTimelineFixture({
    events: args.events,
    projectionOptions: {
      includeDebugRawEvents: args.includeDebugRawEvents,
      threadStatus: "idle",
      turnMessageDetail: "summary",
    },
  });
}

function rowSignature(row: TimelineRow): string {
  if (row.kind === "conversation") {
    return `conversation:${row.role}`;
  }
  if (row.kind === "system") {
    return `system:${row.systemKind}`;
  }
  if (row.kind === "work") {
    return `work:${row.workKind}`;
  }
  return `turn:${row.sourceSeqStart}-${row.sourceSeqEnd}`;
}

function rowSignatures(rows: readonly TimelineRow[]): string[] {
  return rows.map(rowSignature);
}

function turnRows(rows: readonly TimelineRow[]): TimelineTurnRow[] {
  return rows.filter((row): row is TimelineTurnRow => row.kind === "turn");
}

function topLevelWorkRows(rows: readonly TimelineRow[]): TimelineWorkRow[] {
  return rows.filter((row): row is TimelineWorkRow => row.kind === "work");
}

function requireOnlyTurnRow(rows: readonly TimelineRow[]): TimelineTurnRow {
  const rowsForTurns = turnRows(rows);
  expect(rowsForTurns).toHaveLength(1);
  const row = rowsForTurns[0];
  if (!row) {
    throw new Error("Expected one turn row");
  }
  return row;
}

describe("completed turn summary rendering", () => {
  it("emits a summary row for a completed final turn after accepted user input", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const request = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "got it lets work on the daemon command blobs",
    });

    const timeline = renderCompletedTimeline({
      events: [
        request,
        event.turnStarted(),
        event.inputAccepted({
          clientRequestId: request.data.requestId,
        }),
        event.commandCompleted({
          itemId: "tool-1",
          command: "pnpm test",
        }),
        event.assistantCompleted({
          itemId: "assistant-1",
          text: "Implemented durable daemon command blob pruning.",
        }),
        event.turnCompleted(),
      ],
    });

    expect(rowSignatures(timeline.rows)).toEqual([
      "conversation:user",
      "turn:4-4",
      "conversation:assistant",
    ]);
    expect(topLevelWorkRows(timeline.rows)).toHaveLength(0);

    const turnRow = requireOnlyTurnRow(timeline.rows);
    expect(turnRow).toMatchObject({
      completedAt: 6,
      sourceSeqEnd: 4,
      sourceSeqStart: 4,
      startedAt: 2,
      status: "completed",
      summaryCount: 1,
    });
    expect(rowSignatures(turnRow.children ?? [])).toEqual(["work:command"]);
  });

  it("emits summary rows when every completed turn starts from accepted user input", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const firstRequest = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Investigate the timeline behavior",
    });
    const events: TimelineFixtureEvent[] = [
      firstRequest,
      event.turnStarted({ turnId: "turn-1" }),
      event.inputAccepted({
        clientRequestId: firstRequest.data.requestId,
        turnId: "turn-1",
      }),
      event.commandCompleted({
        command: "rg turn-summary packages/thread-view",
        itemId: "tool-1",
        turnId: "turn-1",
      }),
      event.assistantCompleted({
        itemId: "assistant-1",
        text: "The renderer flattens segmented summaries.",
        turnId: "turn-1",
      }),
      event.turnCompleted({ turnId: "turn-1" }),
    ];
    const secondRequest = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Apply the focused fix",
    });
    events.push(
      secondRequest,
      event.turnStarted({ turnId: "turn-2" }),
      event.inputAccepted({
        clientRequestId: secondRequest.data.requestId,
        turnId: "turn-2",
      }),
      event.fileChangeCompleted({
        changes: [
          {
            kind: "update",
            path: "packages/thread-view/src/build-thread-timeline.ts",
          },
        ],
        itemId: "edit-1",
        turnId: "turn-2",
      }),
      event.assistantCompleted({
        itemId: "assistant-2",
        text: "Updated the completed-turn renderer.",
        turnId: "turn-2",
      }),
      event.turnCompleted({ turnId: "turn-2" }),
    );
    const thirdRequest = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Run validation",
    });
    events.push(
      thirdRequest,
      event.turnStarted({ turnId: "turn-3" }),
      event.inputAccepted({
        clientRequestId: thirdRequest.data.requestId,
        turnId: "turn-3",
      }),
      event.commandCompleted({
        command: "pnpm exec turbo run test --filter=@bb/thread-view",
        itemId: "tool-3",
        turnId: "turn-3",
      }),
      event.assistantCompleted({
        itemId: "assistant-3",
        text: "Thread-view validation passed.",
        turnId: "turn-3",
      }),
      event.turnCompleted({ turnId: "turn-3" }),
    );

    const timeline = renderCompletedTimeline({ events });

    expect(rowSignatures(timeline.rows)).toEqual([
      "conversation:user",
      "turn:4-4",
      "conversation:assistant",
      "conversation:user",
      "turn:10-10",
      "conversation:assistant",
      "conversation:user",
      "turn:16-16",
      "conversation:assistant",
    ]);
    expect(topLevelWorkRows(timeline.rows)).toHaveLength(0);
    expect(turnRows(timeline.rows).map((row) => row.summaryCount)).toEqual([
      1, 1, 1,
    ]);
    expect(
      turnRows(timeline.rows).map((row) => rowSignatures(row.children ?? [])),
    ).toEqual([["work:command"], ["work:file-change"], ["work:command"]]);
  });

  it("keeps summary rows on both sides of an accepted in-turn steer", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events: TimelineFixtureEvent[] = [
      event.turnStarted(),
      event.commandCompleted({
        itemId: "tool-before-steer",
        command: "pnpm test",
      }),
    ];
    const steerRequest = event.clientTurnRequested({
      target: { kind: "auto", expectedTurnId: "turn-1" },
      text: "Please account for the restart",
    });
    events.push(
      steerRequest,
      event.inputAccepted({
        clientRequestId: steerRequest.data.requestId,
      }),
      event.commandCompleted({
        itemId: "tool-after-steer",
        command: "sqlite3 ~/.bb-dev/bb.db '.tables'",
      }),
      event.assistantCompleted({
        itemId: "assistant-1",
        text: "Done.",
      }),
      event.turnCompleted(),
    );

    const timeline = renderCompletedTimeline({
      events,
    });

    expect(rowSignatures(timeline.rows)).toEqual([
      "turn:2-2",
      "conversation:user",
      "turn:5-5",
      "conversation:assistant",
    ]);
    expect(topLevelWorkRows(timeline.rows)).toHaveLength(0);
    expect(turnRows(timeline.rows).map((row) => row.summaryCount)).toEqual([
      1, 1,
    ]);
    expect(
      turnRows(timeline.rows).map((row) => rowSignatures(row.children ?? [])),
    ).toEqual([["work:command"], ["work:command"]]);
  });

  it("does not split completed turn summaries around accepted assistant steers", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events: TimelineFixtureEvent[] = [
      event.turnStarted(),
      event.commandCompleted({
        itemId: "tool-before-steer",
        command: "pnpm test",
      }),
    ];
    const steerRequest = event.clientTurnRequested({
      initiator: "agent",
      senderThreadId: "thr_parent",
      target: { kind: "auto", expectedTurnId: "turn-1" },
      text: "Please account for the restart",
    });
    events.push(
      steerRequest,
      event.inputAccepted({
        clientRequestId: steerRequest.data.requestId,
      }),
      event.commandCompleted({
        itemId: "tool-after-steer",
        command: "sqlite3 ~/.bb-dev/bb.db '.tables'",
      }),
      event.assistantCompleted({
        itemId: "assistant-1",
        text: "Done.",
      }),
      event.turnCompleted(),
    );

    const timeline = renderCompletedTimeline({ events });

    expect(rowSignatures(timeline.rows)).toEqual([
      "turn:1-7",
      "conversation:assistant",
    ]);
    expect(topLevelWorkRows(timeline.rows)).toHaveLength(0);

    const turnRow = requireOnlyTurnRow(timeline.rows);
    expect(turnRow.summaryCount).toBe(3);
    expect(rowSignatures(turnRow.children ?? [])).toEqual([
      "work:command",
      "conversation:user",
      "work:command",
    ]);
  });

  it("does not split completed turn summaries around accepted system steers", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events: TimelineFixtureEvent[] = [
      event.turnStarted(),
      event.commandCompleted({
        itemId: "tool-before-steer",
        command: "pnpm test",
      }),
    ];
    const steerRequest = event.clientTurnRequested({
      initiator: "system",
      senderThreadId: null,
      target: { kind: "auto", expectedTurnId: "turn-1" },
      text: "[bb system] Continue after reconnect.",
    });
    events.push(
      steerRequest,
      event.inputAccepted({
        clientRequestId: steerRequest.data.requestId,
      }),
      event.commandCompleted({
        itemId: "tool-after-steer",
        command: "sqlite3 ~/.bb-dev/bb.db '.tables'",
      }),
      event.assistantCompleted({
        itemId: "assistant-1",
        text: "Done.",
      }),
      event.turnCompleted(),
    );

    const timeline = renderCompletedTimeline({ events });

    expect(rowSignatures(timeline.rows)).toEqual([
      "turn:1-7",
      "conversation:assistant",
    ]);
    expect(topLevelWorkRows(timeline.rows)).toHaveLength(0);

    const turnRow = requireOnlyTurnRow(timeline.rows);
    expect(turnRow.summaryCount).toBe(3);
    expect(rowSignatures(turnRow.children ?? [])).toEqual([
      "work:command",
      "conversation:user",
      "work:command",
    ]);
  });

  it("splits completed turn summaries around converted legacy user messages", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });

    const timeline = renderCompletedTimeline({
      events: [
        event.turnStarted(),
        event.commandCompleted({
          itemId: "tool-before-message",
          command: "pnpm test",
        }),
        event.legacyUserMessage({
          text: "Visible legacy update",
        }),
        event.commandCompleted({
          itemId: "tool-after-message",
          command: "git status --short",
        }),
        event.assistantCompleted({
          itemId: "assistant-1",
          text: "Done.",
        }),
        event.turnCompleted(),
      ],
    });

    expect(rowSignatures(timeline.rows)).toEqual([
      "turn:2-2",
      "conversation:assistant",
      "turn:4-4",
      "conversation:assistant",
    ]);
    expect(topLevelWorkRows(timeline.rows)).toHaveLength(0);
    expect(turnRows(timeline.rows).map((row) => row.summaryCount)).toEqual([
      1, 1,
    ]);
    expect(
      turnRows(timeline.rows).map((row) => rowSignatures(row.children ?? [])),
    ).toEqual([["work:command"], ["work:command"]]);
  });

  it("keeps default-quiet provider-unhandled events out of summary rows", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });

    const timeline = renderCompletedTimeline({
      events: [
        event.turnStarted(),
        event.commandCompleted({
          itemId: "tool-before-debug",
          command: "pnpm test",
        }),
        event.providerUnhandled({
          rawType: "session.unexpected",
        }),
        event.commandCompleted({
          itemId: "tool-after-debug",
          command: "git status --short",
        }),
        event.assistantCompleted({
          itemId: "assistant-1",
          text: "Done.",
        }),
        event.turnCompleted(),
      ],
      includeDebugRawEvents: true,
    });

    expect(rowSignatures(timeline.rows)).toEqual([
      "turn:1-6",
      "conversation:assistant",
    ]);
    expect(topLevelWorkRows(timeline.rows)).toHaveLength(0);
    expect(turnRows(timeline.rows).map((row) => row.summaryCount)).toEqual([2]);
  });

  it("does not synthesize empty summary rows for user-only completed turns", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const request = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "No work needed",
    });

    const timeline = renderCompletedTimeline({
      events: [
        request,
        event.turnStarted(),
        event.inputAccepted({
          clientRequestId: request.data.requestId,
        }),
        event.assistantCompleted({
          itemId: "assistant-1",
          text: "Done.",
        }),
        event.turnCompleted(),
      ],
    });

    expect(rowSignatures(timeline.rows)).toEqual([
      "conversation:user",
      "conversation:assistant",
    ]);
    expect(turnRows(timeline.rows)).toHaveLength(0);
  });
});
