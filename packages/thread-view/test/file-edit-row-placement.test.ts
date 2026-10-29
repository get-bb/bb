import { describe, expect, it } from "vitest";
import type { EventMeta } from "../src/event-decode.js";
import type {
  EventProjectionFileEditChange,
  EventProjectionFileEditMessage,
  EventProjectionMessage,
} from "../src/event-projection-types.js";
import type { FileEditPartial } from "../src/file-edit-parsing.js";
import {
  createOperationProjectionState,
  flushPendingFileEditOutput,
  onCompactionBegin,
  upsertFileEdit,
  type OperationProjectionState,
} from "../src/operation-projection.js";

const THREAD_ID = "thread-1";

function wholeListReplacement(
  messages: readonly EventProjectionMessage[],
  callId: string,
  nextRows: readonly EventProjectionFileEditMessage[],
): EventProjectionMessage[] {
  const insertionIndex = messages.findIndex(
    (message) => message.kind === "file-edit" && message.callId === callId,
  );
  const messagesWithoutCallRows = messages.filter(
    (message) => message.kind !== "file-edit" || message.callId !== callId,
  );
  if (insertionIndex === -1) {
    messagesWithoutCallRows.push(...nextRows);
  } else {
    messagesWithoutCallRows.splice(insertionIndex, 0, ...nextRows);
  }
  return messagesWithoutCallRows;
}

type FileEditStatus = EventProjectionFileEditMessage["status"];

type UpsertOp =
  | {
      kind: "changes";
      callId: string;
      changes: EventProjectionFileEditChange[];
      status: FileEditStatus;
      turnId: string | undefined;
    }
  | {
      kind: "output";
      callId: string;
      delta: string;
      turnId: string | undefined;
    };

type Op = UpsertOp | { kind: "other" } | { kind: "flush" };

function metaAt(seq: number): EventMeta {
  return { id: `event-${seq}`, seq, createdAt: 1_000 + seq };
}

function partialFor(op: UpsertOp): FileEditPartial {
  return op.kind === "changes"
    ? {
        callId: op.callId,
        changes: op.changes,
        approvalStatus: null,
        status: op.status,
      }
    : {
        callId: op.callId,
        stdout: op.delta,
        appendStdout: true,
        status: "pending",
      };
}

function applyUpsert(
  state: OperationProjectionState,
  op: UpsertOp,
  seq: number,
): void {
  upsertFileEdit(state, metaAt(seq), THREAD_ID, op.turnId, partialFor(op));
}

function applyOther(state: OperationProjectionState, seq: number): void {
  onCompactionBegin(state, metaAt(seq), THREAD_ID, undefined, {
    key: `compaction-${seq}`,
    kind: "begin",
  });
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function generateOps(seed: number, count: number): Op[] {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) {
      throw new Error("pick needs a non-empty list");
    }
    return item;
  };
  const callIds = Array.from({ length: 10 }, (_, index) => `call-${index}`);
  const turnIds = ["thread", "turn-a", "turn-b"];
  const paths = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];
  const deltas = ["x", "y\n", "line one\nline", "\n", "tail"];
  const statuses: readonly FileEditStatus[] = ["pending", "completed", "error"];
  const stickyTurnByCallId = new Map(
    callIds.map((callId) => [callId, pick(turnIds)]),
  );
  const turnFor = (callId: string): string | undefined => {
    const turnId =
      random() < 0.85 ? stickyTurnByCallId.get(callId) : pick(turnIds);
    return turnId === "thread" ? undefined : turnId;
  };
  const ops: Op[] = [];
  for (let index = 0; index < count; index += 1) {
    const roll = random();
    const callId = pick(callIds);
    if (roll < 0.4) {
      ops.push({
        kind: "changes",
        callId,
        changes: Array.from(
          { length: Math.floor(random() * 4) },
          (): EventProjectionFileEditChange => ({
            path: pick(paths),
            kind: "update",
            movePath: random() < 0.2 ? pick(paths) : null,
            diff: `diff-${index}`,
          }),
        ),
        status: pick(statuses),
        turnId: turnFor(callId),
      });
    } else if (roll < 0.75) {
      ops.push({
        kind: "output",
        callId,
        delta: pick(deltas),
        turnId: turnFor(callId),
      });
    } else if (roll < 0.9) {
      ops.push({ kind: "other" });
    } else {
      ops.push({ kind: "flush" });
    }
  }
  return ops;
}

function countIndexReads(
  state: OperationProjectionState,
  run: () => void,
): number {
  const target = state.messages;
  let reads = 0;
  const counted = new Proxy(target, {
    get(proxyTarget, property, receiver) {
      if (typeof property === "string" && /^\d+$/u.test(property)) {
        reads += 1;
      }
      return Reflect.get(proxyTarget, property, receiver);
    },
  });
  state.messages = counted;
  try {
    run();
  } finally {
    if (state.messages === counted) {
      state.messages = target;
    }
  }
  return reads;
}

function rowLabels(state: OperationProjectionState): string[] {
  return state.messages.map((message) =>
    message.kind === "file-edit"
      ? `${message.callId}:${message.scope.kind === "turn" ? message.scope.turnId : "thread"}`
      : message.kind,
  );
}

describe("file-edit row placement", () => {
  it("places rows exactly like a whole-list replacement on random event sequences", () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const state = createOperationProjectionState([]);
      for (const [index, op] of generateOps(seed, 400).entries()) {
        const seq = index + 1;
        if (op.kind === "flush") {
          flushPendingFileEditOutput(state);
          continue;
        }
        if (op.kind === "other") {
          applyOther(state, seq);
          continue;
        }
        const before = [...state.messages];
        const rowsBefore = state.fileEditsByCallId.get(op.callId) ?? [];
        applyUpsert(state, op, seq);
        const rowsAfter = state.fileEditsByCallId.get(op.callId) ?? [];
        const expected =
          op.kind === "changes" && op.changes.length > 0
            ? wholeListReplacement(before, op.callId, rowsAfter)
            : [
                ...before,
                ...rowsAfter.filter((row) => !rowsBefore.includes(row)),
              ];
        expect(state.messages).toHaveLength(expected.length);
        expect(
          state.messages.findIndex(
            (message, position) => message !== expected[position],
          ),
          `seed ${seed}, event ${seq}`,
        ).toBe(-1);
      }
    }
  });

  it("regroups a call's rows from several scopes when a change repeats the same rows", () => {
    const state = createOperationProjectionState([]);
    const output = (turnId: string | undefined, seq: number) =>
      applyUpsert(
        state,
        { kind: "output", callId: "call-1", delta: "x", turnId },
        seq,
      );
    const change = (seq: number) =>
      applyUpsert(
        state,
        {
          kind: "changes",
          callId: "call-1",
          changes: [{ path: "a.ts", kind: "update", diff: "d" }],
          status: "pending",
          turnId: undefined,
        },
        seq,
      );

    output("turn-b", 1);
    change(2);
    applyOther(state, 3);
    output("turn-a", 4);
    output(undefined, 5);
    expect(rowLabels(state)).toEqual([
      "call-1:turn-b",
      "call-1:thread",
      "operation",
      "call-1:turn-a",
    ]);

    change(6);

    expect(rowLabels(state)).toEqual([
      "call-1:turn-b",
      "call-1:turn-a",
      "call-1:thread",
      "operation",
    ]);
  });

  it("updates an existing call's rows without scanning the message list", () => {
    const state = createOperationProjectionState([]);
    const callCount = 300;
    const change = (call: number, seq: number, diff: string) =>
      applyUpsert(
        state,
        {
          kind: "changes",
          callId: `call-${call}`,
          changes: [{ path: `file-${call}.ts`, kind: "update", diff }],
          status: "pending",
          turnId: "turn-a",
        },
        seq,
      );
    for (let call = 0; call < callCount; call += 1) {
      applyOther(state, call * 10);
      change(call, call * 10 + 1, "d1");
    }
    const messageCount = state.messages.length;

    let reads = 0;
    for (let call = 0; call < callCount; call += 1) {
      reads += countIndexReads(state, () => change(call, 5_000 + call, "d2"));
    }

    expect(reads).toBeLessThan(messageCount);
    expect(state.messages).toHaveLength(messageCount);
  });
});
