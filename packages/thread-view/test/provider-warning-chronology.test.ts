import { threadScope, turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  createTimelineEventFactory,
  flattenTimelineRows,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

const warningCases = [
  { location: "before the turn", seq: 10, scope: threadScope() },
  { location: "during the turn", seq: 40, scope: threadScope() },
  { location: "after the answer", seq: 90, scope: threadScope() },
  { location: "after the turn", seq: 110, scope: threadScope() },
  { location: "inside turn scope", seq: 40, scope: turnScope("turn-1") },
];

describe.each(["collapse", "flat"] as const)(
  "%s provider warning chronology",
  (completedTurnDisplay) => {
    describe.each([
      "general",
      "config",
      "deprecation",
      "session-settings",
    ] as const)("%s warnings", (category) => {
      it.each(warningCases)(
        "preserves sequence order for a warning $location",
        ({ seq, scope }) => {
          const event = createTimelineEventFactory({
            threadId: "thread-1",
            turnId: "turn-1",
          });
          const warning = event.providerWarning({
            seq,
            category,
            summary: "Provider notice",
          });
          const rendered = renderTimelineFixture({
            completedTurnDisplay,
            events: [
              event.turnStarted({ seq: 20 }),
              { ...warning, scope },
              event.assistantCompleted({ seq: 80, text: "Answer ready" }),
              event.turnCompleted({ seq: 100 }),
            ].sort((left, right) => left.seq - right.seq),
            projectionOptions: {
              threadStatus: "idle",
              turnMessageDetail: "full",
            },
          });
          const messageRows = flattenTimelineRows(rendered.rows).filter(
            (row) => row.kind === "system" || row.kind === "conversation",
          );

          expect(messageRows.map((row) => row.sourceSeqStart)).toEqual(
            seq < 80 ? [seq, 80] : [80, seq],
          );
        },
      );
    });
  },
);

describe("session-settings notes in a collapsed completed turn", () => {
  function collapsedTurn(category: "general" | "session-settings") {
    const event = createTimelineEventFactory({
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const rendered = renderTimelineFixture({
      completedTurnDisplay: "collapse",
      includeNestedRows: false,
      events: [
        event.turnStarted({ seq: 20 }),
        event.commandCompleted({ seq: 30, itemId: "command-1", command: "ls" }),
        {
          ...event.providerWarning({
            seq: 40,
            category,
            summary: "Changed model applies from the next turn.",
          }),
          scope: threadScope(),
        },
        event.commandCompleted({
          seq: 50,
          itemId: "command-2",
          command: "pwd",
        }),
        event.assistantCompleted({ seq: 80, text: "Answer ready" }),
        event.turnCompleted({ seq: 100 }),
      ],
      projectionOptions: { threadStatus: "idle", turnMessageDetail: "summary" },
    });
    return rendered.rows.map((row) =>
      row.kind === "system"
        ? `${row.systemKind}:${row.systemKind === "operation" ? row.operationKind : ""}:${row.sourceSeqStart}`
        : `${row.kind}:${row.sourceSeqStart}`,
    );
  }

  it("keeps a session-settings note visible between the turn's work groups", () => {
    expect(collapsedTurn("session-settings")).toMatchInlineSnapshot(`
      [
        "turn:30",
        "operation:warning:40",
        "turn:50",
        "conversation:80",
      ]
    `);
  });

  it("keeps other warnings inside the collapsed work group", () => {
    expect(collapsedTurn("general")).toMatchInlineSnapshot(`
      [
        "turn:20",
        "conversation:80",
      ]
    `);
  });
});
