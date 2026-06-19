import { turnScope } from "@bb/domain";
import type { Thread, ThreadEventPlanStep } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { extractThreadTimelinePendingPlan } from "../src/plan-snapshot-extraction.js";
import type { ThreadEventWithMeta } from "../src/build-event-projection.js";

const ACTIVE: Thread["status"] = "active";

interface TurnPlanEventArgs {
  explanation?: string;
  plan: ThreadEventPlanStep[];
  seq: number;
}

function turnPlanEvent({
  explanation,
  plan,
  seq,
}: TurnPlanEventArgs): ThreadEventWithMeta {
  return {
    event: {
      type: "turn/plan/updated",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      plan,
      ...(explanation !== undefined ? { explanation } : {}),
    },
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq,
    },
  };
}

function nonPlanEvent(seq: number): ThreadEventWithMeta {
  return {
    event: {
      type: "item/completed",
      threadId: "thread-1",
      providerThreadId: "provider-thread-1",
      scope: turnScope("turn-1"),
      item: {
        type: "agentMessage",
        id: "message-1",
        text: "done",
      },
    },
    meta: { id: `event-${seq}`, seq, createdAt: seq },
  };
}

describe("extractThreadTimelinePendingPlan", () => {
  it("returns null when no plan snapshot is observed", () => {
    expect(extractThreadTimelinePendingPlan(ACTIVE, [])).toBeNull();
    expect(
      extractThreadTimelinePendingPlan(ACTIVE, [nonPlanEvent(1)]),
    ).toBeNull();
  });

  it("returns the latest turn/plan/updated snapshot", () => {
    const result = extractThreadTimelinePendingPlan(ACTIVE, [
      turnPlanEvent({
        seq: 5,
        plan: [{ step: "old step", status: "pending" }],
      }),
      turnPlanEvent({
        seq: 12,
        explanation: "Follow the provider plan.",
        plan: [
          { step: "step a", status: "active" },
          { step: "step b", status: "pending" },
          { step: "step c", status: "completed" },
        ],
      }),
    ]);
    expect(result).toEqual({
      sourceSeq: 12,
      updatedAt: 12,
      explanation: "Follow the provider plan.",
      steps: [
        { id: "plan:12:0", text: "step a", status: "active" },
        { id: "plan:12:1", text: "step b", status: "pending" },
        { id: "plan:12:2", text: "step c", status: "completed" },
      ],
    });
  });

  it("keeps failed steps and skips empty step text", () => {
    const result = extractThreadTimelinePendingPlan(ACTIVE, [
      turnPlanEvent({
        seq: 9,
        explanation: "   ",
        plan: [
          { step: "kept active", status: "active" },
          { step: "kept failure", status: "failed" },
          { step: "   ", status: "pending" },
          { step: "kept pending" },
        ],
      }),
    ]);
    expect(result).toEqual({
      sourceSeq: 9,
      updatedAt: 9,
      explanation: null,
      steps: [
        { id: "plan:9:0", text: "kept active", status: "active" },
        { id: "plan:9:1", text: "kept failure", status: "failed" },
        { id: "plan:9:3", text: "kept pending", status: "pending" },
      ],
    });
  });

  it.each<Thread["status"]>([
    "error",
    "idle",
    "starting",
    "stopping",
  ])("returns null when the thread status is %s", (status) => {
    expect(
      extractThreadTimelinePendingPlan(status, [
        turnPlanEvent({
          seq: 1,
          plan: [{ step: "active plan", status: "active" }],
        }),
      ]),
    ).toBeNull();
  });
});
