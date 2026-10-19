import { describe, expect, it } from "vitest";
import {
  evaluateQueuedMessageTransition,
  QUEUED_MESSAGE_LIFECYCLE,
  queuedMessageStateFor,
  queuedMessageStateValues,
  type QueuedMessageStateFacts,
} from "../src/queued-message-lifecycle.js";

const factNames = [
  "claimed",
  "failed",
  "retryBooked",
  "scheduled",
  "waiting",
] as const satisfies readonly (keyof QueuedMessageStateFacts)[];

function everyFactCombination(): QueuedMessageStateFacts[] {
  return Array.from({ length: 2 ** factNames.length }, (_, bits) => {
    const facts: QueuedMessageStateFacts = {
      claimed: false,
      failed: false,
      retryBooked: false,
      scheduled: false,
      waiting: false,
    };
    factNames.forEach((name, index) => {
      facts[name] = (bits & (1 << index)) !== 0;
    });
    return facts;
  });
}

describe("queuedMessageStateFor", () => {
  it("lets the claim win, then the failure, then the schedule, then the wait", () => {
    for (const facts of everyFactCombination()) {
      const expected = facts.claimed
        ? "claimed"
        : facts.failed
          ? facts.retryBooked
            ? "failed_retrying"
            : "failed_exhausted"
          : facts.scheduled
            ? "scheduled"
            : facts.waiting
              ? "waiting"
              : "queued";
      expect(queuedMessageStateFor(facts)).toBe(expected);
    }
  });
});

describe("QUEUED_MESSAGE_LIFECYCLE", () => {
  it("has a row for every state and for creation", () => {
    expect(Object.keys(QUEUED_MESSAGE_LIFECYCLE).sort()).toEqual(
      ["new", ...queuedMessageStateValues].sort(),
    );
  });

  it("only leaves a claim by releasing it or re-queueing it", () => {
    expect(Object.keys(QUEUED_MESSAGE_LIFECYCLE.claimed).sort()).toEqual([
      "claim.released",
      "wait.recorded",
    ]);
    expect(
      evaluateQueuedMessageTransition({
        from: "claimed",
        event: "dispatch.claimed",
        to: "claimed",
      }),
    ).toEqual({ illegal: "no dispatch.claimed transition from claimed" });
    expect(
      evaluateQueuedMessageTransition({
        from: "claimed",
        event: "drain.failed",
        to: "failed_retrying",
      }),
    ).toEqual({ illegal: "no drain.failed transition from claimed" });
  });

  it("keeps a failure when only the wait is cleared", () => {
    expect(
      evaluateQueuedMessageTransition({
        from: "failed_retrying",
        event: "wait.cleared",
        to: "queued",
      }),
    ).toEqual({
      illegal: "wait.cleared from failed_retrying cannot land on queued",
    });
    expect(
      evaluateQueuedMessageTransition({
        from: "failed_exhausted",
        event: "wait.cleared",
        to: "failed_exhausted",
      }),
    ).toEqual({ to: "failed_exhausted" });
  });

  it("never creates a row that is already claimed or failed", () => {
    for (const to of [
      "claimed",
      "failed_retrying",
      "failed_exhausted",
    ] as const) {
      expect(
        evaluateQueuedMessageTransition({
          from: "new",
          event: "queue.created",
          to,
        }),
      ).toHaveProperty("illegal");
    }
  });
});
