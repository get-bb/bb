import { describe, expect, it } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

type TimelineWorkRow = Extract<TimelineRow, { kind: "work" }>;
type TimelineSystemRow = Extract<TimelineRow, { kind: "system" }>;

function getNestedRows(row: TimelineRow): readonly TimelineRow[] {
  if (row.kind === "turn") {
    return row.children ?? [];
  }
  if (row.kind === "work" && row.workKind === "delegation") {
    return row.childRows;
  }
  return [];
}

function flattenTimelineRows(rows: readonly TimelineRow[]): TimelineRow[] {
  const flattenedRows: TimelineRow[] = [];
  const visitRows = (currentRows: readonly TimelineRow[]): void => {
    for (const row of currentRows) {
      flattenedRows.push(row);
      visitRows(getNestedRows(row));
    }
  };
  visitRows(rows);
  return flattenedRows;
}

function getOnlyWorkRowByCallId(
  rows: readonly TimelineRow[],
  callId: string,
): TimelineWorkRow {
  const matches = flattenTimelineRows(rows).filter(
    (row): row is TimelineWorkRow =>
      row.kind === "work" && "callId" in row && row.callId === callId,
  );
  expect(matches).toHaveLength(1);
  const row = matches[0];
  if (!row) {
    throw new Error(`Expected work row for ${callId}`);
  }
  return row;
}

function getTopLevelSystemRows(
  rows: readonly TimelineRow[],
): TimelineSystemRow[] {
  return rows.filter((row): row is TimelineSystemRow => row.kind === "system");
}

function renderIdleTimeline(events: ThreadEventRow[]) {
  return renderTimelineFixture({
    events,
    projectionOptions: {
      threadStatus: "idle",
      turnMessageDetail: "full",
    },
  });
}

describe("timeline interruption projection", () => {
  it("keeps post-turn automatic compaction pending while the thread is idle", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events = [
      event.turnStarted({ createdAt: 0 }),
      event.turnCompleted({ createdAt: 1_000 }),
      event.contextCompactionStarted({ createdAt: 2_000 }),
    ];
    const timeline = renderIdleTimeline(events);

    expect(timeline.messages).toContainEqual(
      expect.objectContaining({
        kind: "operation",
        opType: "compaction",
        status: "pending",
        title: "Compacting context",
        completedAt: null,
      }),
    );

    const completedTimeline = renderIdleTimeline([
      ...events,
      event.threadCompacted({ createdAt: 3_000 }),
    ]);
    expect(completedTimeline.messages).toContainEqual(
      expect.objectContaining({
        kind: "operation",
        opType: "compaction",
        status: "completed",
        title: "Context compacted",
        completedAt: 3_000,
      }),
    );
  });

  it("settles a skipped manual compaction from the provider warning", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderIdleTimeline([
      event.turnStarted({ createdAt: 0 }),
      event.contextCompactionStarted({ createdAt: 1_000 }),
      event.providerWarning({
        category: "compaction-skipped",
        summary: "Context compaction skipped",
        details: "Compaction failed: Nothing to compact (session too small)",
        createdAt: 2_000,
      }),
      event.turnCompleted({ createdAt: 3_000 }),
    ]);

    expect(timeline.messages).toContainEqual(
      expect.objectContaining({
        kind: "operation",
        opType: "compaction",
        status: "completed",
        title: "Context compaction skipped",
        detail: "Compaction failed: Nothing to compact (session too small)",
        completedAt: 2_000,
      }),
    );
    expect(
      timeline.messages.some(
        (message) =>
          message.kind === "operation" && message.opType === "warning",
      ),
    ).toBe(false);
  });

  it("keeps a pending compaction and renders an unrelated warning in the same turn", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderTimelineFixture({
      events: [
        event.turnStarted({ createdAt: 0 }),
        event.contextCompactionStarted({ createdAt: 1_000 }),
        event.providerWarning({
          summary: "Model fallback",
          details: "Requested model unavailable; using a fallback.",
          createdAt: 2_000,
        }),
      ],
      projectionOptions: {
        threadStatus: "active",
        turnMessageDetail: "full",
      },
    });

    expect(timeline.messages).toContainEqual(
      expect.objectContaining({
        kind: "operation",
        opType: "compaction",
        status: "pending",
        title: "Compacting context",
        completedAt: null,
      }),
    );
    expect(timeline.messages).toContainEqual(
      expect.objectContaining({
        kind: "operation",
        opType: "warning",
        title: "Model fallback",
        detail: "Requested model unavailable; using a fallback.",
      }),
    );
  });

  it("interrupts post-turn compaction when the thread is explicitly interrupted", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderIdleTimeline([
      event.turnStarted({ createdAt: 0 }),
      event.turnCompleted({ createdAt: 1_000 }),
      event.contextCompactionStarted({ createdAt: 2_000 }),
      event.systemThreadInterrupted({ createdAt: 3_000 }),
    ]);

    expect(timeline.messages).toContainEqual(
      expect.objectContaining({
        kind: "operation",
        opType: "compaction",
        status: "interrupted",
        title: "Context compaction interrupted",
        completedAt: 3_000,
      }),
    );
  });

  it("does not apply an old thread interruption to a later compaction", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderIdleTimeline([
      event.turnStarted({ turnId: "turn-a", createdAt: 0 }),
      event.turnCompleted({
        turnId: "turn-a",
        status: "interrupted",
        createdAt: 1_000,
      }),
      event.systemThreadInterrupted({ createdAt: 1_100 }),
      event.turnStarted({ turnId: "turn-b", createdAt: 2_000 }),
      event.turnCompleted({ turnId: "turn-b", createdAt: 3_000 }),
      event.contextCompactionStarted({
        turnId: "turn-b",
        createdAt: 4_000,
      }),
    ]);

    expect(timeline.messages).toContainEqual(
      expect.objectContaining({
        kind: "operation",
        opType: "compaction",
        status: "pending",
        title: "Compacting context",
        completedAt: null,
      }),
    );
  });

  it("uses interrupted turn completion time for pending command and tool rows", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderIdleTimeline([
      event.turnStarted({ createdAt: 0 }),
      event.commandStarted({
        itemId: "cmd-1",
        command: "pnpm test",
        createdAt: 1_000,
      }),
      event.toolCallStarted({
        itemId: "tool-1",
        tool: "LookupTool",
        arguments: { query: "select:TodoWrite" },
        createdAt: 2_000,
      }),
      event.turnCompleted({
        status: "interrupted",
        createdAt: 6_000,
      }),
    ]);

    const commandRow = getOnlyWorkRowByCallId(timeline.rows, "cmd-1");
    const toolRow = getOnlyWorkRowByCallId(timeline.rows, "tool-1");

    expect(commandRow).toMatchObject({
      workKind: "command",
      status: "interrupted",
      startedAt: 1_000,
      completedAt: 6_000,
    });
    expect(toolRow).toMatchObject({
      workKind: "tool",
      status: "interrupted",
      startedAt: 2_000,
      completedAt: 6_000,
    });
  });

  it("uses system interruption time for pending command and web rows", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderIdleTimeline([
      event.turnStarted({ createdAt: 0 }),
      event.commandStarted({
        itemId: "cmd-1",
        command: "pnpm test",
        createdAt: 1_000,
      }),
      event.webSearchStarted({
        itemId: "web-1",
        queries: ["timeline renderer"],
        createdAt: 2_000,
      }),
      event.systemThreadInterrupted({ createdAt: 5_000 }),
    ]);

    const commandRow = getOnlyWorkRowByCallId(timeline.rows, "cmd-1");
    const webRow = getOnlyWorkRowByCallId(timeline.rows, "web-1");

    expect(commandRow).toMatchObject({
      workKind: "command",
      status: "interrupted",
      startedAt: 1_000,
      completedAt: 5_000,
    });
    expect(webRow).toMatchObject({
      workKind: "web-search",
      status: "interrupted",
      startedAt: 2_000,
      completedAt: 5_000,
    });
  });

  it("omits an interruption operation row when the preceding error already explains the failed turn", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderIdleTimeline([
      event.turnStarted({ createdAt: 0 }),
      event.commandStarted({
        itemId: "cmd-1",
        command: "pnpm test",
        createdAt: 1_000,
      }),
      event.turnCompleted({
        status: "interrupted",
        createdAt: 6_000,
      }),
      event.systemError({
        code: "thread_command_failed",
        message: "Thread interrupted because the host daemon disconnected",
        detail: "Please retry the thread to continue.",
        createdAt: 6_000,
      }),
      event.systemThreadInterrupted({
        reason: "host-daemon-restarted",
        createdAt: 6_000,
      }),
    ]);

    expect(getTopLevelSystemRows(timeline.rows)).toEqual([
      expect.objectContaining({
        systemKind: "error",
        title: "Thread interrupted because the host daemon disconnected",
        detail: "Please retry the thread to continue.",
      }),
    ]);
  });
});
