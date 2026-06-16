import { threadScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { extractThreadTimelineGoal } from "../src/goal-snapshot-extraction.js";
import type { ThreadEventWithMeta } from "../src/build-event-projection.js";

function goalUpdatedEvent({
  objective,
  seq,
}: {
  objective: string;
  seq: number;
}): ThreadEventWithMeta {
  return {
    event: {
      type: "thread/goal/updated",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: threadScope(),
      objective,
      status: "active",
      tokenBudget: 10_000,
      tokensUsed: 250,
      timeUsedSeconds: 30,
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq * 100,
    },
  };
}

function goalClearedEvent(seq: number): ThreadEventWithMeta {
  return {
    event: {
      type: "thread/goal/cleared",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: threadScope(),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq * 100,
    },
  };
}

describe("extractThreadTimelineGoal", () => {
  it("returns the latest goal update", () => {
    expect(
      extractThreadTimelineGoal([
        goalUpdatedEvent({ seq: 1, objective: "Old goal" }),
        goalUpdatedEvent({ seq: 2, objective: "Current goal" }),
      ]),
    ).toEqual({
      sourceSeq: 2,
      updatedAt: 200,
      objective: "Current goal",
      status: "active",
      tokenBudget: 10_000,
      tokensUsed: 250,
      timeUsedSeconds: 30,
    });
  });

  it("returns null when a later clear supersedes an update", () => {
    expect(
      extractThreadTimelineGoal([
        goalUpdatedEvent({ seq: 1, objective: "Current goal" }),
        goalClearedEvent(2),
      ]),
    ).toBeNull();
  });
});
