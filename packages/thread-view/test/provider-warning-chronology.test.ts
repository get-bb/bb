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
    describe.each(["general", "config", "deprecation"] as const)(
      "%s warnings",
      (category) => {
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
      },
    );
  },
);
