import { describe, expect, it } from "vitest";
import { compactThreadTimelineSummaryEvents } from "../src/index.js";
import {
  createTimelineEventFactory,
  fromRows,
} from "./timeline-test-harness.js";

type TimelineEventFactory = ReturnType<typeof createTimelineEventFactory>;
type TimelineEventRow = ReturnType<
  TimelineEventFactory[keyof TimelineEventFactory]
>;

function createFactory(): TimelineEventFactory {
  return createTimelineEventFactory({ threadId: "thread-1" });
}

function compactedEventIds(rows: TimelineEventRow[]): string[] {
  return compactThreadTimelineSummaryEvents(fromRows(rows)).map(
    (eventWithMeta) => eventWithMeta.meta.id,
  );
}

describe("compactThreadTimelineSummaryEvents", () => {
  it("returns the original events when the delta threshold is not met", () => {
    const events = createFactory();
    const rows = Array.from({ length: 999 }, (_, index) =>
      events.assistantDelta({
        seq: index + 1,
        delta: `chunk-${index + 1}`,
        itemId: "msg-1",
      }),
    );
    const decodedEvents = fromRows(rows);

    expect(compactThreadTimelineSummaryEvents(decodedEvents)).toBe(
      decodedEvents,
    );
  });

  it("returns the original events when there are no completed agent messages to compact", () => {
    const events = createFactory();
    const rows = Array.from({ length: 1000 }, (_, index) =>
      events.assistantDelta({
        seq: index + 1,
        delta: `chunk-${index + 1}`,
        itemId: "msg-1",
      }),
    );

    expect(compactedEventIds(rows)).toEqual(rows.map((row) => row.id));
  });

  it("keeps the first delta for each completed agent message independently", () => {
    const events = createFactory();
    const firstMessageDeltas = Array.from({ length: 500 }, (_, index) =>
      events.assistantDelta({
        seq: index + 1,
        delta: `chunk-${index + 1}`,
        itemId: "msg-1",
      }),
    );
    const secondMessageDeltas = Array.from({ length: 500 }, (_, index) =>
      events.assistantDelta({
        seq: index + 501,
        delta: `chunk-${index + 501}`,
        itemId: "msg-2",
      }),
    );
    const incompleteMessageDelta = events.assistantDelta({
      seq: 1001,
      delta: "incomplete",
      itemId: "msg-3",
    });
    const firstCompletedMessage = events.assistantCompleted({
      seq: 1002,
      itemId: "msg-1",
      text: "message-1002",
    });
    const secondCompletedMessage = events.assistantCompleted({
      seq: 1003,
      itemId: "msg-2",
      text: "message-1003",
    });

    expect(
      compactedEventIds([
        ...firstMessageDeltas,
        ...secondMessageDeltas,
        incompleteMessageDelta,
        firstCompletedMessage,
        secondCompletedMessage,
      ]),
    ).toEqual([
      firstMessageDeltas[0]?.id,
      secondMessageDeltas[0]?.id,
      incompleteMessageDelta.id,
      firstCompletedMessage.id,
      secondCompletedMessage.id,
    ]);
  });

  it("does not compact later-turn deltas when the same item id is reused across turns", () => {
    const events = createFactory();
    const completedTurnDeltas = Array.from({ length: 1000 }, (_, index) =>
      events.assistantDelta({
        seq: index + 1,
        delta: `chunk-${index + 1}`,
        itemId: "msg-1",
        turnId: "turn-1",
      }),
    );
    const laterTurnDeltaOne = events.assistantDelta({
      seq: 1001,
      delta: "later-one",
      itemId: "msg-1",
      turnId: "turn-2",
    });
    const laterTurnDeltaTwo = events.assistantDelta({
      seq: 1002,
      delta: "later-two",
      itemId: "msg-1",
      turnId: "turn-2",
    });
    const completedTurnMessage = events.assistantCompleted({
      seq: 1003,
      itemId: "msg-1",
      text: "message-1003",
      turnId: "turn-1",
    });

    expect(
      compactedEventIds([
        ...completedTurnDeltas,
        laterTurnDeltaOne,
        laterTurnDeltaTwo,
        completedTurnMessage,
      ]),
    ).toEqual([
      completedTurnDeltas[0]?.id,
      laterTurnDeltaOne.id,
      laterTurnDeltaTwo.id,
      completedTurnMessage.id,
    ]);
  });

  it("keeps same-turn deltas for a different parent tool call even when item ids match", () => {
    const events = createFactory();
    const completedParentDeltas = Array.from({ length: 1000 }, (_, index) =>
      events.assistantDelta({
        seq: index + 1,
        delta: `chunk-${index + 1}`,
        itemId: "msg-1",
        parentToolCallId: "tool-1",
      }),
    );
    const siblingParentDeltaOne = events.assistantDelta({
      seq: 1001,
      delta: "sibling-one",
      itemId: "msg-1",
      parentToolCallId: "tool-2",
    });
    const siblingParentDeltaTwo = events.assistantDelta({
      seq: 1002,
      delta: "sibling-two",
      itemId: "msg-1",
      parentToolCallId: "tool-2",
    });
    const completedMessage = events.assistantCompleted({
      seq: 1003,
      itemId: "msg-1",
      parentToolCallId: "tool-1",
      text: "message-1003",
    });

    expect(
      compactedEventIds([
        ...completedParentDeltas,
        siblingParentDeltaOne,
        siblingParentDeltaTwo,
        completedMessage,
      ]),
    ).toEqual([
      completedParentDeltas[0]?.id,
      siblingParentDeltaOne.id,
      siblingParentDeltaTwo.id,
      completedMessage.id,
    ]);
  });
});
