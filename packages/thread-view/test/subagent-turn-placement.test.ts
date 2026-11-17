import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@bb/server-contract";
import {
  createTimelineEventFactory,
  type TimelineEventFactory,
  flattenTimelineRows,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

function renderSubagentTurns(completedTurnDisplay: "collapse" | "flat") {
  const event = createTimelineEventFactory({
    threadId: "thread-1",
    turnId: "root",
  });
  const spawn = (itemId: string, seq: number) =>
    event.delegationStarted({
      seq,
      itemId,
      childRef: `child-${itemId}`,
      label: `/root/${itemId}`,
    });
  const settle = (
    itemId: string,
    seq: number,
    status: "completed" | "failed",
  ) =>
    event.delegationCompleted({
      seq,
      itemId,
      childRef: `child-${itemId}`,
      label: `/root/${itemId}`,
      status,
    });
  const deprecation = (seq: number) => ({
    ...event.providerWarning({ seq, summary: "multi_agent is deprecated" }),
    scope: { kind: "thread" as const },
  });
  return renderTimelineFixture({
    completedTurnDisplay,
    includeNestedRows: true,
    events: [
      event.turnStarted({ seq: 1 }),
      spawn("first", 2),
      deprecation(3),
      event.turnStarted({
        seq: 4,
        turnId: "child-1",
        parentToolCallId: "first",
      }),
      spawn("second", 5),
      deprecation(6),
      event.turnStarted({
        seq: 7,
        turnId: "child-2",
        parentToolCallId: "second",
      }),
      spawn("third", 8),
      deprecation(9),
      event.turnStarted({
        seq: 10,
        turnId: "child-3",
        parentToolCallId: "third",
      }),
      event.assistantCompleted({
        seq: 11,
        turnId: "child-1",
        parentToolCallId: "first",
        text: "First done",
      }),
      event.turnCompleted({ seq: 12, turnId: "child-1" }),
      settle("first", 13, "completed"),
      event.assistantCompleted({
        seq: 14,
        turnId: "child-2",
        parentToolCallId: "second",
        text: "Second done",
      }),
      event.turnCompleted({ seq: 15, turnId: "child-2" }),
      settle("second", 16, "completed"),
      event.providerError({
        seq: 17,
        turnId: "child-3",
        message: "Provider error",
        detail: "child request rejected",
        willRetry: false,
      }),
      event.turnCompleted({ seq: 18, turnId: "child-3", status: "failed" }),
      settle("third", 19, "failed"),
      event.providerError({
        seq: 20,
        message: "Provider error",
        detail: "root request rejected",
        willRetry: false,
      }),
      event.turnCompleted({ seq: 21, status: "failed" }),
    ],
    projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
  });
}

function rootLevelRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn" ? [row, ...(row.children ?? [])] : [row],
  );
}

describe.each(["collapse", "flat"] as const)(
  "%s subagent turns",
  (completedTurnDisplay) => {
    const rendered = renderSubagentTurns(completedTurnDisplay);

    it("never surface as their own top-level turn rows", () => {
      expect(
        rendered.rows.filter(
          (row) => row.turnId !== null && row.turnId !== "root",
        ),
      ).toEqual([]);
    });

    it("keep thread-scoped warnings in the root turn in sequence order", () => {
      expect(
        rootLevelRows(rendered.rows)
          .filter((row) => row.kind === "work" || row.kind === "system")
          .map((row) => row.sourceSeqStart),
      ).toEqual([2, 3, 5, 6, 8, 9, 20]);
    });

    it("nest a subagent's provider error under its delegation", () => {
      const third = flattenTimelineRows(rendered.rows).find(
        (row) =>
          row.kind === "work" &&
          row.workKind === "delegation" &&
          row.callId === "third",
      );
      expect(
        third?.kind === "work" && third.workKind === "delegation"
          ? third.childRows?.map((row) => row.sourceSeqStart)
          : null,
      ).toEqual([17]);
    });
  },
);

const childTurnEventCases = [
  {
    name: "turn-scoped warning",
    make: (event: TimelineEventFactory) =>
      event.providerWarning({ seq: 4, turnId: "child", summary: "notice" }),
  },
  {
    name: "provider error",
    make: (event: TimelineEventFactory) =>
      event.providerError({
        seq: 4,
        turnId: "child",
        message: "Provider error",
        detail: "rejected",
        willRetry: false,
      }),
  },
  {
    name: "unhandled provider event",
    make: (event: TimelineEventFactory) =>
      event.providerUnhandled({ seq: 4, turnId: "child" }),
  },
  {
    name: "provider user message",
    make: (event: TimelineEventFactory) =>
      event.providerUserMessage({ seq: 4, turnId: "child", text: "Task" }),
  },
];

describe("messages from a subagent turn", () => {
  it.each(childTurnEventCases)(
    "nest a $name under the delegation",
    ({ make }) => {
      const event = createTimelineEventFactory({
        threadId: "thread-1",
        turnId: "root",
      });
      const rendered = renderTimelineFixture({
        completedTurnDisplay: "collapse",
        includeNestedRows: true,
        events: [
          event.turnStarted({ seq: 1 }),
          event.delegationStarted({
            seq: 2,
            itemId: "spawn",
            childRef: "child-thread",
            label: "/root/worker",
          }),
          event.turnStarted({
            seq: 3,
            turnId: "child",
            parentToolCallId: "spawn",
          }),
          make(event),
          event.turnCompleted({ seq: 5, turnId: "child" }),
          event.delegationCompleted({
            seq: 6,
            itemId: "spawn",
            childRef: "child-thread",
            label: "/root/worker",
          }),
          event.turnCompleted({ seq: 7 }),
        ],
        projectionOptions: {
          includeDiagnosticOperations: true,
          threadStatus: "idle",
          turnMessageDetail: "full",
        },
      });
      const delegation = flattenTimelineRows(rendered.rows).find(
        (row) => row.kind === "work" && row.workKind === "delegation",
      );

      expect(rendered.rows.map((row) => row.turnId)).toEqual(["root"]);
      expect(
        delegation?.kind === "work" && delegation.workKind === "delegation"
          ? delegation.childRows?.map((row) => row.sourceSeqStart)
          : null,
      ).toEqual([4]);
    },
  );
});
