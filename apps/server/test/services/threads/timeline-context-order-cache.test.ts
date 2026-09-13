import { describe, expect, it } from "vitest";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  type ThreadEventType,
} from "@bb/domain";
import {
  deleteThreadEventSuffixInTransaction,
  getLatestCompletedThreadContextClearSequence,
  getLatestThreadSequence,
  pruneThreadEventsBeforeSequence,
} from "@bb/db";
import {
  clearTimelineOrderingContextCache,
  getTimelineGroupingContext,
} from "../../../src/services/threads/timeline-context-order.js";
import {
  appendRows,
  createRandom,
  pick,
  randomInteger,
  withTestThread,
  type Random,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";

const SEEDS = 20;

function expectCachedEqualsCold(
  testThread: TestThread,
  maxSeq: number,
  sequenceStart = 0,
): ReturnType<typeof getTimelineGroupingContext> {
  const args = { maxSeq, sequenceStart, threadId: testThread.thread.id };
  const cached = getTimelineGroupingContext(testThread.db, args);
  clearTimelineOrderingContextCache(testThread.coldDb);
  expect(cached, JSON.stringify(args)).toEqual(
    getTimelineGroupingContext(testThread.coldDb, args),
  );
  return cached;
}

function captureStatementSql(db: TestThread["db"], run: () => void): string[] {
  const captured: string[] = [];
  const raw = db.$client;
  const originalPrepare = raw.prepare.bind(raw);
  Object.defineProperty(raw, "prepare", {
    configurable: true,
    writable: true,
    value: (source: string) => {
      captured.push(source);
      return originalPrepare(source);
    },
  });
  try {
    run();
  } finally {
    Object.defineProperty(raw, "prepare", {
      configurable: true,
      writable: true,
      value: originalPrepare,
    });
  }
  return captured;
}

function turnStarted(turnId: string): RowSpec {
  return { turnId, type: "turn/started" };
}

function turnCompleted(turnId: string): RowSpec {
  return { data: { status: "completed" }, turnId, type: "turn/completed" };
}

function userRequest(requestId: string): RowSpec {
  return {
    data: {
      initiator: "user",
      input: [{ text: "hello", type: "text" }],
      requestId,
      target: { kind: "new-turn" },
    },
    type: "client/turn/requested",
  };
}

function accepted(requestId: string, turnId: string): RowSpec {
  return {
    data: { clientRequestId: requestId },
    turnId,
    type: "turn/input/accepted",
  };
}

function rootToolCall(
  itemId: string,
  turnId: string,
  type: "item/started" | "item/completed",
): RowSpec {
  return { itemId, itemKind: "toolCall", turnId, type };
}

function child(parentToolCallId: string, index: number): RowSpec {
  return {
    itemId: `child-${parentToolCallId}-${index}`,
    itemKind: "agentMessage",
    parentToolCallId,
    turnId: `nested-${parentToolCallId}`,
    type: "item/started",
  };
}

function delta(turnId: string, text: string): RowSpec {
  return {
    data: { delta: text, itemId: "message-1" },
    itemId: "message-1",
    turnId,
    type: "item/agentMessage/delta",
  };
}

function reasoningDelta(turnId: string): RowSpec {
  return {
    data: { contentIndex: 0, delta: "thinking", itemId: "reasoning-1" },
    itemId: "reasoning-1",
    turnId,
    type: "item/reasoning/textDelta",
  };
}

describe("timeline grouping context cache", () => {
  it("reuses the context across appended deltas and root tool-call rows without re-reading it", () => {
    withTestThread((testThread) => {
      appendRows(testThread, [
        turnStarted("turn-1"),
        userRequest("request-1"),
        accepted("request-1", "turn-1"),
        rootToolCall("call-1", "turn-1", "item/started"),
        child("call-1", 1),
        userRequest("request-2"),
      ]);
      const warm = expectCachedEqualsCold(
        testThread,
        appendRows(testThread, [child("call-1", 2)]),
      );
      expect(warm.orderingBoundarySequence).toBe(6);

      const maxSeq = appendRows(testThread, [
        delta("turn-1", "Hello"),
        delta("turn-1", " world"),
        reasoningDelta("turn-1"),
        rootToolCall("call-2", "turn-1", "item/started"),
        rootToolCall("call-2", "turn-1", "item/completed"),
      ]);
      const statements = captureStatementSql(testThread.db, () => {
        expect(expectCachedEqualsCold(testThread, maxSeq)).toBe(warm);
      });
      expect(statements).toEqual([
        expect.stringContaining('"parent_tool_call_id" is not null'),
      ]);
    });
  });

  it.each([
    {
      name: "turn/completed extends a turn past an external request",
      seed: [turnStarted("turn-1"), userRequest("request-1")],
      appended: [turnCompleted("turn-1")],
      before: null,
      after: 2,
    },
    {
      name: "an accepted steer claims the request for its turn",
      seed: [
        turnStarted("turn-1"),
        userRequest("request-1"),
        turnCompleted("turn-1"),
      ],
      appended: [accepted("request-1", "turn-1")],
      before: 2,
      after: null,
    },
    {
      name: "a late root turn/started admits a delegating parent",
      seed: [
        rootToolCall("call-1", "turn-2", "item/started"),
        userRequest("request-1"),
        child("call-1", 1),
      ],
      appended: [turnStarted("turn-2")],
      before: null,
      after: 2,
    },
    {
      name: "a user request inside an open parent span",
      seed: [
        turnStarted("turn-1"),
        rootToolCall("call-1", "turn-1", "item/started"),
        child("call-1", 1),
      ],
      appended: [userRequest("request-1"), child("call-1", 2)],
      before: null,
      after: 5,
    },
    {
      name: "a parented child extends a span past a user request",
      seed: [
        turnStarted("turn-1"),
        rootToolCall("call-1", "turn-1", "item/started"),
        child("call-1", 1),
        userRequest("request-1"),
      ],
      appended: [child("call-1", 2)],
      before: null,
      after: 4,
    },
  ])("recomputes when $name", (testCase) => {
    withTestThread((testThread) => {
      const warm = expectCachedEqualsCold(
        testThread,
        appendRows(testThread, testCase.seed),
      );
      expect(warm.orderingBoundarySequence).toBe(testCase.before);

      const maxSeq = appendRows(testThread, [
        delta("turn-1", "before"),
        ...testCase.appended,
        delta("turn-1", "after"),
      ]);
      expect(
        expectCachedEqualsCold(testThread, maxSeq).orderingBoundarySequence,
      ).toBe(testCase.after);
    });
  });

  it("reuses the context when a delegating item id is reused in a later turn", () => {
    withTestThread((testThread) => {
      const warm = expectCachedEqualsCold(
        testThread,
        appendRows(testThread, [
          turnStarted("turn-1"),
          rootToolCall("call-1", "turn-1", "item/started"),
          userRequest("request-1"),
          child("call-1", 1),
          turnCompleted("turn-1"),
          turnStarted("turn-2"),
        ]),
      );
      expect(warm.orderingBoundarySequence).toBe(3);

      const reusedMaxSeq = appendRows(testThread, [
        rootToolCall("call-1", "turn-2", "item/started"),
        rootToolCall("call-1", "turn-2", "item/completed"),
      ]);
      expect(expectCachedEqualsCold(testThread, reusedMaxSeq)).toBe(warm);
      expectCachedEqualsCold(
        testThread,
        appendRows(testThread, [userRequest("request-2")]),
      );
    });
  });

  it.each([
    {
      name: "a suffix rewrite on the same connection",
      remove: (testThread: TestThread, sequence: number) => {
        testThread.db.transaction((tx) => {
          deleteThreadEventSuffixInTransaction(tx, {
            cutoffSequence: sequence,
            oldMaxSequence: sequence,
            threadId: testThread.thread.id,
          });
        });
      },
    },
    {
      name: "another connection deletes a context row",
      remove: (testThread: TestThread, sequence: number) => {
        testThread.coldDb.$client
          .prepare("DELETE FROM events WHERE thread_id = ? AND sequence = ?")
          .run(testThread.thread.id, sequence);
      },
    },
  ])(
    "recomputes after $name leaves only appendable rows in the probed range",
    ({ remove }) => {
      withTestThread((testThread) => {
        const warmMaxSeq = appendRows(testThread, [
          turnStarted("turn-1"),
          rootToolCall("call-1", "turn-1", "item/started"),
          userRequest("request-1"),
          child("call-1", 1),
        ]);
        expect(
          expectCachedEqualsCold(testThread, warmMaxSeq)
            .orderingBoundarySequence,
        ).toBe(3);

        remove(testThread, warmMaxSeq);
        const maxSeq = appendRows(testThread, [
          delta("turn-1", "replacement"),
          delta("turn-1", " text"),
        ]);
        expect(
          expectCachedEqualsCold(testThread, maxSeq).orderingBoundarySequence,
        ).toBeNull();
      });
    },
  );

  it("serves an older snapshot below a cached entry only when no context rows lie between them", () => {
    withTestThread((testThread) => {
      const olderMaxSeq = appendRows(testThread, [
        turnStarted("turn-1"),
        userRequest("request-1"),
        delta("turn-1", "a"),
      ]);
      const latest = expectCachedEqualsCold(
        testThread,
        appendRows(testThread, [delta("turn-1", "b"), delta("turn-1", "c")]),
      );
      expect(expectCachedEqualsCold(testThread, olderMaxSeq)).toBe(latest);

      const completedMaxSeq = appendRows(testThread, [turnCompleted("turn-1")]);
      expect(
        expectCachedEqualsCold(testThread, completedMaxSeq)
          .orderingBoundarySequence,
      ).toBe(2);
      expect(
        expectCachedEqualsCold(testThread, olderMaxSeq)
          .orderingBoundarySequence,
      ).toBeNull();
    });
  });

  it("matches a cold computation over randomized appends, rewrites and prunes", () => {
    let comparisons = 0;
    let changedContexts = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const random = createRandom(seed);
      withTestThread((testThread) => {
        let previousBoundary: number | null = null;
        for (let step = 0; step < 40; step += 1) {
          applyRandomStep(testThread, random, step);
          const latest = getLatestThreadSequence(testThread.db, {
            threadId: testThread.thread.id,
          });
          const probes = [latest, latest - randomInteger(random, 1, 6), latest];
          for (const maxSeq of probes) {
            if (maxSeq < 0) continue;
            const sequenceStart =
              random() < 0.8
                ? (getLatestCompletedThreadContextClearSequence(testThread.db, {
                    atOrBeforeSequence: maxSeq,
                    threadId: testThread.thread.id,
                  }) ?? 0)
                : randomInteger(random, 0, Math.max(0, maxSeq));
            const cached = expectCachedEqualsCold(
              testThread,
              maxSeq,
              sequenceStart,
            );
            comparisons += 1;
            if (cached.orderingBoundarySequence !== previousBoundary) {
              changedContexts += 1;
              previousBoundary = cached.orderingBoundarySequence;
            }
          }
        }
      });
    }
    expect(comparisons).toBeGreaterThan(SEEDS * 100);
    expect(changedContexts).toBeGreaterThan(SEEDS * 10);
  }, 60_000);
});

const RANDOM_TURN_IDS = ["turn-a", "turn-b", "turn-c"] as const;
const RANDOM_CALL_IDS = ["call-a", "call-b"] as const;
const RANDOM_REQUEST_IDS = ["request-a", "request-b", "request-c"] as const;
const RANDOM_PRUNED_TYPES = [
  "turn/started",
  "turn/completed",
  "client/turn/requested",
  "turn/input/accepted",
  "item/started",
  "item/agentMessage/delta",
] as const satisfies readonly ThreadEventType[];

function randomRow(random: Random): RowSpec {
  const turnId = pick(random, RANDOM_TURN_IDS);
  const choice = random();
  if (choice < 0.3) return delta(turnId, pick(random, ["x", "y\n"]));
  if (choice < 0.36) return reasoningDelta(turnId);
  if (choice < 0.46) {
    return rootToolCall(
      pick(random, RANDOM_CALL_IDS),
      turnId,
      pick(random, ["item/started", "item/completed"]),
    );
  }
  if (choice < 0.56) {
    return child(pick(random, RANDOM_CALL_IDS), randomInteger(random, 1, 99));
  }
  if (choice < 0.66) {
    const request = userRequest(pick(random, RANDOM_REQUEST_IDS));
    return random() < 0.8
      ? request
      : { ...request, data: { ...request.data, initiator: "agent" } };
  }
  if (choice < 0.74) {
    return accepted(pick(random, RANDOM_REQUEST_IDS), turnId);
  }
  if (choice < 0.82) return turnStarted(turnId);
  if (choice < 0.9) return turnCompleted(turnId);
  if (choice < 0.95) {
    return {
      data: { status: "completed" },
      parentToolCallId: pick(random, RANDOM_CALL_IDS),
      turnId: "nested-turn",
      type: "turn/started",
    };
  }
  return {
    data: {
      initiator: "user",
      operation: THREAD_CONTEXT_CLEAR_OPERATION,
      status: pick(random, ["completed", "running"]),
    },
    type: "system/operation",
  };
}

function applyRandomStep(testThread: TestThread, random: Random, step: number) {
  const threadId = testThread.thread.id;
  const latest = getLatestThreadSequence(testThread.db, { threadId });
  const choice = random();
  if (step > 3 && choice < 0.08) {
    const cutoffSequence = randomInteger(
      random,
      Math.max(1, latest - 4),
      latest,
    );
    testThread.db.transaction((tx) => {
      deleteThreadEventSuffixInTransaction(tx, {
        cutoffSequence,
        oldMaxSequence: latest,
        threadId,
      });
    });
    return;
  }
  if (step > 3 && choice < 0.14) {
    pruneThreadEventsBeforeSequence(testThread.db, {
      sequenceCutoff: randomInteger(random, 1, latest),
      threadId,
      types: [pick(random, RANDOM_PRUNED_TYPES)],
    });
    return;
  }
  appendRows(
    testThread,
    Array.from({ length: randomInteger(random, 1, 4) }, () =>
      randomRow(random),
    ),
  );
}
