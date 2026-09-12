import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  THREAD_CONTEXT_CLEAR_OPERATION,
  threadScope,
  turnScope,
  type ThreadEventItemType,
  type ThreadEventType,
} from "@bb/domain";
import {
  createConnection,
  createProject,
  createThread,
  deleteThreadEventSuffixInTransaction,
  getLatestCompletedThreadContextClearSequence,
  getLatestThreadSequence,
  insertEvents,
  migrate,
  noopNotifier,
  pruneThreadEventsBeforeSequence,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import {
  clearTimelineOrderingContextCache,
  getTimelineGroupingContext,
} from "../../../src/services/threads/timeline-context-order.js";

type EventInput = Parameters<typeof insertEvents>[2][number];

interface TestThread {
  coldDb: DbConnection;
  db: DbConnection;
  dir: string;
  threadId: string;
}

interface ContextArgs {
  maxSeq: number;
  sequenceStart: number;
  threadId: string;
}

interface RowSpec {
  data?: Record<string, unknown>;
  itemId?: string | null;
  itemKind?: ThreadEventItemType | null;
  parentToolCallId?: string | null;
  turnId?: string | null;
  type: ThreadEventType;
}

type Random = () => number;

const CONTEXT_SQL_MARKERS = ["$.clientRequestId", "root_start"] as const;
const SEEDS = 20;

let migratedImage: Buffer | null = null;

function readMigratedImage(): Buffer {
  if (migratedImage === null) {
    const db = createConnection(":memory:");
    migrate(db);
    migratedImage = db.$client.serialize();
    db.$client.close();
  }
  return migratedImage;
}

function setup(): TestThread {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-context-cache-"));
  const file = path.join(dir, "bb.db");
  fs.writeFileSync(file, readMigratedImage());
  const db = createConnection(file);
  const host = upsertHost(db, noopNotifier, { name: "context-cache-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "context-cache-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/context" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { coldDb: createConnection(file), db, dir, threadId: thread.id };
}

function teardown(thread: TestThread): void {
  thread.coldDb.$client.close();
  thread.db.$client.close();
  fs.rmSync(thread.dir, { force: true, recursive: true });
}

function append(
  { db, threadId }: TestThread,
  specs: readonly RowSpec[],
): number {
  let sequence = getLatestThreadSequence(db, { threadId });
  const rows: EventInput[] = specs.map((spec) => {
    sequence += 1;
    const turnId = spec.turnId ?? null;
    return {
      data: JSON.stringify(spec.data ?? {}),
      itemId: spec.itemId ?? null,
      itemKind: spec.itemKind ?? null,
      parentToolCallId: spec.parentToolCallId ?? null,
      scope: turnId === null ? threadScope() : turnScope(turnId),
      sequence,
      threadId,
      type: spec.type,
    };
  });
  insertEvents(db, noopNotifier, rows);
  return sequence;
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

function coldContext(thread: TestThread, args: ContextArgs) {
  clearTimelineOrderingContextCache(thread.coldDb);
  return getTimelineGroupingContext(thread.coldDb, args);
}

function captureStatementSql(db: DbConnection, run: () => void): string[] {
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

function readsContextSql(statements: readonly string[]): boolean {
  return statements.some((source) =>
    CONTEXT_SQL_MARKERS.some((marker) => source.includes(marker)),
  );
}

function expectCachedEqualsCold(
  thread: TestThread,
  args: ContextArgs,
): ReturnType<typeof getTimelineGroupingContext> {
  const cached = getTimelineGroupingContext(thread.db, args);
  expect(cached).toEqual(coldContext(thread, args));
  return cached;
}

describe("timeline grouping context cache", () => {
  it("reuses the context across appended deltas and root tool-call rows without re-reading it", () => {
    const thread = setup();
    try {
      append(thread, [
        turnStarted("turn-1"),
        userRequest("request-1"),
        accepted("request-1", "turn-1"),
        rootToolCall("call-1", "turn-1", "item/started"),
        child("call-1", 1),
        userRequest("request-2"),
      ]);
      const warmMaxSeq = append(thread, [child("call-1", 2)]);
      const warm = getTimelineGroupingContext(thread.db, {
        maxSeq: warmMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(warm.orderingBoundarySequence).toBe(6);

      const maxSeq = append(thread, [
        delta("turn-1", "Hello"),
        delta("turn-1", " world"),
        reasoningDelta("turn-1"),
        rootToolCall("call-2", "turn-1", "item/started"),
        rootToolCall("call-2", "turn-1", "item/completed"),
      ]);
      const args = { maxSeq, sequenceStart: 0, threadId: thread.threadId };
      let cached: ReturnType<typeof getTimelineGroupingContext> | null = null;
      const statements = captureStatementSql(thread.db, () => {
        cached = getTimelineGroupingContext(thread.db, args);
      });
      expect(readsContextSql(statements)).toBe(false);
      expect(statements).toHaveLength(1);
      expect(cached).toBe(warm);
      expect(cached).toEqual(coldContext(thread, args));
    } finally {
      teardown(thread);
    }
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
    const thread = setup();
    try {
      const warmMaxSeq = append(thread, testCase.seed);
      const warm = expectCachedEqualsCold(thread, {
        maxSeq: warmMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(warm.orderingBoundarySequence).toBe(testCase.before);

      const maxSeq = append(thread, [
        delta("turn-1", "before"),
        ...testCase.appended,
        delta("turn-1", "after"),
      ]);
      const cached = expectCachedEqualsCold(thread, {
        maxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(cached.orderingBoundarySequence).toBe(testCase.after);
    } finally {
      teardown(thread);
    }
  });

  it("reuses the context when a delegating item id is reused in a later turn", () => {
    const thread = setup();
    try {
      const warmMaxSeq = append(thread, [
        turnStarted("turn-1"),
        rootToolCall("call-1", "turn-1", "item/started"),
        userRequest("request-1"),
        child("call-1", 1),
        turnCompleted("turn-1"),
        turnStarted("turn-2"),
      ]);
      const warm = expectCachedEqualsCold(thread, {
        maxSeq: warmMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(warm.orderingBoundarySequence).toBe(3);

      const reusedMaxSeq = append(thread, [
        rootToolCall("call-1", "turn-2", "item/started"),
        rootToolCall("call-1", "turn-2", "item/completed"),
      ]);
      const reusedArgs = {
        maxSeq: reusedMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      };
      const statements = captureStatementSql(thread.db, () => {
        expect(getTimelineGroupingContext(thread.db, reusedArgs)).toBe(warm);
      });
      expect(readsContextSql(statements)).toBe(false);
      expect(getTimelineGroupingContext(thread.db, reusedArgs)).toEqual(
        coldContext(thread, reusedArgs),
      );

      const requestedMaxSeq = append(thread, [userRequest("request-2")]);
      expectCachedEqualsCold(thread, {
        maxSeq: requestedMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
    } finally {
      teardown(thread);
    }
  });

  it("recomputes after a suffix rewrite that leaves only appendable rows in the probed range", () => {
    const thread = setup();
    try {
      const warmMaxSeq = append(thread, [
        turnStarted("turn-1"),
        rootToolCall("call-1", "turn-1", "item/started"),
        userRequest("request-1"),
        child("call-1", 1),
      ]);
      const warm = expectCachedEqualsCold(thread, {
        maxSeq: warmMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(warm.orderingBoundarySequence).toBe(3);

      thread.db.transaction((tx) => {
        deleteThreadEventSuffixInTransaction(tx, {
          cutoffSequence: warmMaxSeq,
          oldMaxSequence: warmMaxSeq,
          threadId: thread.threadId,
        });
      });
      const maxSeq = append(thread, [
        delta("turn-1", "replacement"),
        delta("turn-1", " text"),
      ]);
      const cached = expectCachedEqualsCold(thread, {
        maxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(cached.orderingBoundarySequence).toBeNull();
    } finally {
      teardown(thread);
    }
  });

  it("recomputes after another connection deletes context rows", () => {
    const thread = setup();
    const writer = createConnection(path.join(thread.dir, "bb.db"));
    try {
      const warmMaxSeq = append(thread, [
        turnStarted("turn-1"),
        rootToolCall("call-1", "turn-1", "item/started"),
        userRequest("request-1"),
        child("call-1", 1),
      ]);
      const warm = expectCachedEqualsCold(thread, {
        maxSeq: warmMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(warm.orderingBoundarySequence).toBe(3);

      writer.$client
        .prepare("DELETE FROM events WHERE thread_id = ? AND sequence = ?")
        .run(thread.threadId, warmMaxSeq);
      const maxSeq = append(thread, [
        delta("turn-1", "a"),
        delta("turn-1", "b"),
      ]);
      const cached = expectCachedEqualsCold(thread, {
        maxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(cached.orderingBoundarySequence).toBeNull();
    } finally {
      writer.$client.close();
      teardown(thread);
    }
  });

  it("serves an older snapshot below a cached entry only when no context rows lie between them", () => {
    const thread = setup();
    try {
      const olderMaxSeq = append(thread, [
        turnStarted("turn-1"),
        userRequest("request-1"),
        delta("turn-1", "a"),
      ]);
      append(thread, [delta("turn-1", "b"), delta("turn-1", "c")]);
      const latestMaxSeq = getLatestThreadSequence(thread.db, {
        threadId: thread.threadId,
      });
      const latest = expectCachedEqualsCold(thread, {
        maxSeq: latestMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });

      const olderArgs = {
        maxSeq: olderMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      };
      const statements = captureStatementSql(thread.db, () => {
        expect(getTimelineGroupingContext(thread.db, olderArgs)).toBe(latest);
      });
      expect(readsContextSql(statements)).toBe(false);
      expect(getTimelineGroupingContext(thread.db, olderArgs)).toEqual(
        coldContext(thread, olderArgs),
      );

      const completedMaxSeq = append(thread, [turnCompleted("turn-1")]);
      const completed = expectCachedEqualsCold(thread, {
        maxSeq: completedMaxSeq,
        sequenceStart: 0,
        threadId: thread.threadId,
      });
      expect(completed.orderingBoundarySequence).toBe(2);
      const beforeCompletion = expectCachedEqualsCold(thread, olderArgs);
      expect(beforeCompletion.orderingBoundarySequence).toBeNull();
    } finally {
      teardown(thread);
    }
  });

  it("matches a cold computation over randomized appends, rewrites and prunes", () => {
    let comparisons = 0;
    let changedContexts = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const random = createRandom(seed);
      const thread = setup();
      try {
        let previousBoundary: number | null = null;
        for (let step = 0; step < 40; step += 1) {
          applyRandomStep(thread, random, step);
          const latest = getLatestThreadSequence(thread.db, {
            threadId: thread.threadId,
          });
          const probes = [latest, latest - randomInteger(random, 1, 6), latest];
          for (const maxSeq of probes) {
            if (maxSeq < 0) continue;
            const sequenceStart =
              random() < 0.8
                ? (getLatestCompletedThreadContextClearSequence(thread.db, {
                    atOrBeforeSequence: maxSeq,
                    threadId: thread.threadId,
                  }) ?? 0)
                : randomInteger(random, 0, Math.max(0, maxSeq));
            const args = { maxSeq, sequenceStart, threadId: thread.threadId };
            const cached = getTimelineGroupingContext(thread.db, args);
            expect(cached, JSON.stringify({ seed, step, args })).toEqual(
              coldContext(thread, args),
            );
            comparisons += 1;
            if (cached.orderingBoundarySequence !== previousBoundary) {
              changedContexts += 1;
              previousBoundary = cached.orderingBoundarySequence;
            }
          }
        }
      } finally {
        teardown(thread);
      }
    }
    expect(comparisons).toBeGreaterThan(SEEDS * 100);
    expect(changedContexts).toBeGreaterThan(SEEDS * 10);
  }, 60_000);
});

function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomInteger(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(random: Random, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) {
    throw new Error("Expected a non-empty choice list");
  }
  return value;
}

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

function applyRandomStep(thread: TestThread, random: Random, step: number) {
  const latest = getLatestThreadSequence(thread.db, {
    threadId: thread.threadId,
  });
  const choice = random();
  if (step > 3 && choice < 0.08) {
    const cutoffSequence = randomInteger(
      random,
      Math.max(1, latest - 4),
      latest,
    );
    thread.db.transaction((tx) => {
      deleteThreadEventSuffixInTransaction(tx, {
        cutoffSequence,
        oldMaxSequence: latest,
        threadId: thread.threadId,
      });
    });
    return;
  }
  if (step > 3 && choice < 0.14) {
    pruneThreadEventsBeforeSequence(thread.db, {
      sequenceCutoff: randomInteger(random, 1, latest),
      threadId: thread.threadId,
      types: [pick(random, RANDOM_PRUNED_TYPES)],
    });
    return;
  }
  const rows: RowSpec[] = [];
  const count = randomInteger(random, 1, 4);
  for (let index = 0; index < count; index += 1) {
    rows.push(randomRow(random));
  }
  append(thread, rows);
}
