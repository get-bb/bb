import { describe, expect, it } from "vitest";
import type { DispatchHoldResponse } from "@bb/server-contract";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import {
  isDispatchHoldStale,
  orderDispatchHoldsByExpectedDispatch,
  resolveDispatchHoldCancelOutcome,
} from "./dispatch-holds";

const retryTurnRequestId = encodeClientTurnRequestIdNumber({ value: 1 });

function hold(overrides: Partial<DispatchHoldResponse> = {}): DispatchHoldResponse {
  return {
    id: "hold_1",
    kind: "turn",
    threadId: "thr_1",
    holder: "user",
    userReleasable: true,
    reason: "Scheduled",
    payload: {
      kind: "inline",
      input: [{ type: "text", text: "ship it", mentions: [] }],
      execution: {
        model: "sonnet",
        permissionMode: "auto",
        reasoningLevel: "medium",
        serviceTier: "default",
        source: "client/turn/requested",
      },
      editable: true,
    },
    resumeAt: null,
    expectedReleaseAt: null,
    staleAfterMs: null,
    lastReportAt: null,
    createdAt: 1_000,
    releasedAt: null,
    releaseKind: null,
    ...overrides,
  };
}

describe("orderDispatchHoldsByExpectedDispatch", () => {
  it("ranks by resumeAt, then the owner's ETA, then age", () => {
    const scheduledLate = hold({ id: "hold_late", resumeAt: 9_000 });
    const estimatedSoon = hold({ id: "hold_eta", expectedReleaseAt: 3_000 });
    const olderUnscheduled = hold({ id: "hold_old", createdAt: 10 });
    const newerUnscheduled = hold({ id: "hold_new", createdAt: 20 });

    expect(
      orderDispatchHoldsByExpectedDispatch([
        scheduledLate,
        newerUnscheduled,
        estimatedSoon,
        olderUnscheduled,
      ]).map((entry) => entry.id),
    ).toEqual(["hold_old", "hold_new", "hold_eta", "hold_late"]);
  });

  it("prefers resumeAt over the owner's estimate for the same hold", () => {
    const promised = hold({ id: "hold_a", resumeAt: 100, expectedReleaseAt: 5_000 });
    const estimated = hold({ id: "hold_b", expectedReleaseAt: 900 });

    expect(
      orderDispatchHoldsByExpectedDispatch([estimated, promised]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["hold_a", "hold_b"]);
  });
});

describe("isDispatchHoldStale", () => {
  it("is never stale without a declared staleness window", () => {
    expect(
      isDispatchHoldStale(hold({ createdAt: 0, staleAfterMs: null }), 10_000_000),
    ).toBe(false);
  });

  it("goes stale strictly past the window, measured from the last report", () => {
    const reported = hold({
      createdAt: 0,
      lastReportAt: 1_000,
      staleAfterMs: 500,
    });

    expect(isDispatchHoldStale(reported, 1_500)).toBe(false);
    expect(isDispatchHoldStale(reported, 1_501)).toBe(true);
  });

  it("falls back to creation time when the owner has never reported", () => {
    const silent = hold({ createdAt: 1_000, lastReportAt: null, staleAfterMs: 500 });

    expect(isDispatchHoldStale(silent, 1_500)).toBe(false);
    expect(isDispatchHoldStale(silent, 1_600)).toBe(true);
  });
});

describe("resolveDispatchHoldCancelOutcome", () => {
  it("hands an inline hold's text back to the composer", () => {
    const outcome = resolveDispatchHoldCancelOutcome({
      hold: hold(),
      isNeverStartedThread: false,
      liveHoldCount: 1,
    });

    expect(outcome.draft?.text).toBe("ship it");
    expect(outcome.offerDeleteThread).toBe(false);
  });

  it("restores nothing for a retry hold, which references a turn that ran", () => {
    const outcome = resolveDispatchHoldCancelOutcome({
      hold: hold({
        payload: { kind: "retry", retryOfTurnRequestId: retryTurnRequestId },
      }),
      isNeverStartedThread: true,
      liveHoldCount: 1,
    });

    expect(outcome.draft).toBeNull();
    expect(outcome.offerDeleteThread).toBe(true);
  });

  it("offers deletion only when the last hold of a never-started thread goes", () => {
    const args = { hold: hold(), isNeverStartedThread: true };

    expect(
      resolveDispatchHoldCancelOutcome({ ...args, liveHoldCount: 2 })
        .offerDeleteThread,
    ).toBe(false);
    expect(
      resolveDispatchHoldCancelOutcome({ ...args, liveHoldCount: 1 })
        .offerDeleteThread,
    ).toBe(true);
    expect(
      resolveDispatchHoldCancelOutcome({
        ...args,
        isNeverStartedThread: false,
        liveHoldCount: 1,
      }).offerDeleteThread,
    ).toBe(false);
  });
});
