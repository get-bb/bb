import { describe, expect, it, vi } from "vitest";
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
import {
  flushVisibleTextBuffer,
  getVisibleTextBufferText,
  type VisibleTextBuffer,
} from "../src/visible-text-buffer.js";

const THREAD_ID = "thread-1";

function legacyReplaceFileEditMessagesForCall(
  state: Pick<OperationProjectionState, "messages">,
  callId: string,
  nextRows: readonly EventProjectionFileEditMessage[],
): void {
  const insertionIndex = state.messages.findIndex(
    (message) => message.kind === "file-edit" && message.callId === callId,
  );
  const messagesWithoutCallRows = state.messages.filter(
    (message) => message.kind !== "file-edit" || message.callId !== callId,
  );
  if (insertionIndex === -1) {
    messagesWithoutCallRows.push(...nextRows);
  } else {
    messagesWithoutCallRows.splice(insertionIndex, 0, ...nextRows);
  }
  state.messages = messagesWithoutCallRows;
}

function legacyScopedFileEditCallKey(
  callId: string,
  row: Pick<EventProjectionFileEditMessage, "scope">,
): string {
  const discriminator = row.scope.kind === "turn" ? row.scope.turnId : "thread";
  return `${discriminator}:${callId}`;
}

function legacyFlushPendingFileEditOutput(
  state: Pick<
    OperationProjectionState,
    "fileEditsByCallId" | "fileEditStdoutBuffersByScopedCallKey"
  >,
): void {
  const flushedBufferByScopedCallKey = new Map<
    string,
    VisibleTextBuffer | null
  >();
  for (const [callId, fileEdits] of state.fileEditsByCallId.entries()) {
    for (const fileEdit of fileEdits) {
      const scopedCallKey = legacyScopedFileEditCallKey(callId, fileEdit);
      let flushedBuffer = flushedBufferByScopedCallKey.get(scopedCallKey);
      if (flushedBuffer === undefined) {
        const buffer =
          state.fileEditStdoutBuffersByScopedCallKey.get(scopedCallKey);
        flushedBuffer =
          buffer && flushVisibleTextBuffer(buffer) ? buffer : null;
        flushedBufferByScopedCallKey.set(scopedCallKey, flushedBuffer);
      }
      if (flushedBuffer !== null) {
        fileEdit.stdout = getVisibleTextBufferText(flushedBuffer);
      }
    }
  }
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function metaAt(seq: number): EventMeta {
  return { id: `event-${seq}`, seq, createdAt: 1_000 + seq };
}

type FileEditStatus = EventProjectionFileEditMessage["status"];

type Op =
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
    }
  | { kind: "other" }
  | { kind: "flush" };

function partialFor(op: Extract<Op, { kind: "changes" | "output" }>) {
  const partial: FileEditPartial =
    op.kind === "changes"
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
  return partial;
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
  const deltas = ["x", "y\n", "line one\nline", "\n", "tail", "more\nand"];
  const statuses: readonly FileEditStatus[] = ["pending", "completed", "error"];
  const stickyTurnByCallId = new Map<string, string>(
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
      const changes = Array.from(
        { length: Math.floor(random() * 4) },
        (): EventProjectionFileEditChange => ({
          path: pick(paths),
          kind: "update",
          movePath: random() < 0.2 ? pick(paths) : null,
          diff: `diff-${index}`,
        }),
      );
      ops.push({
        kind: "changes",
        callId,
        changes,
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

function applyUpsert(
  state: OperationProjectionState,
  op: Extract<Op, { kind: "changes" | "output" }>,
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

function fileEditStdouts(state: OperationProjectionState): string {
  return JSON.stringify(
    state.messages.flatMap((message) =>
      message.kind === "file-edit" ? [message.id, message.stdout] : [],
    ),
  );
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

describe("file-edit row replacement, old whole-list rebuild vs in-place update", () => {
  it("keeps the same rows in the same order on random upsert sequences", () => {
    const coverage = {
      appended: 0,
      replacedInPlace: 0,
      resized: 0,
      withForeignRows: 0,
      withHint: 0,
    };
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const state = createOperationProjectionState([]);
      let seq = 0;
      for (const op of generateOps(seed, 400)) {
        seq += 1;
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

        let expected: EventProjectionMessage[];
        if (op.kind === "changes" && op.changes.length > 0) {
          const reference = { messages: before };
          legacyReplaceFileEditMessagesForCall(reference, op.callId, rowsAfter);
          expected = reference.messages;
          if (rowsBefore.length === 0) {
            coverage.appended += 1;
          } else if (rowsBefore.length === rowsAfter.length) {
            coverage.replacedInPlace += 1;
          } else {
            coverage.resized += 1;
          }
          if (rowsAfter.some((row) => row.scope.kind !== "thread")) {
            coverage.withForeignRows += 1;
          }
        } else {
          expected = [
            ...before,
            ...rowsAfter.filter((row) => !rowsBefore.includes(row)),
          ];
        }
        expect(state.messages).toHaveLength(expected.length);
        const firstMismatch = state.messages.findIndex(
          (message, index) => message !== expected[index],
        );
        expect(firstMismatch).toBe(-1);
        if (state.fileEditRowsStartIndexByCallId.has(op.callId)) {
          coverage.withHint += 1;
        }
      }
    }
    expect(coverage.appended).toBeGreaterThan(0);
    expect(coverage.replacedInPlace).toBeGreaterThan(0);
    expect(coverage.resized).toBeGreaterThan(0);
    expect(coverage.withForeignRows).toBeGreaterThan(0);
    expect(coverage.withHint).toBeGreaterThan(0);
  });

  it("keeps rows of a call that was split by later messages in the old position", () => {
    const state = createOperationProjectionState([]);
    const changes = [{ path: "a.ts", kind: "update", diff: "d1" }];
    const upsertChanges = (callId: string, seq: number, paths: string[]) =>
      applyUpsert(
        state,
        {
          kind: "changes",
          callId,
          changes: paths.map((path) => ({ ...changes[0]!, path })),
          status: "pending",
          turnId: "turn-a",
        },
        seq,
      );
    upsertChanges("call-1", 1, ["a.ts"]);
    applyOther(state, 2);
    applyUpsert(
      state,
      { kind: "output", callId: "call-1", delta: "x\n", turnId: "turn-b" },
      3,
    );
    upsertChanges("call-2", 4, ["b.ts"]);

    const before = [...state.messages];
    upsertChanges("call-1", 5, ["a.ts", "c.ts"]);
    const reference = { messages: before };
    legacyReplaceFileEditMessagesForCall(
      reference,
      "call-1",
      state.fileEditsByCallId.get("call-1") ?? [],
    );
    expect(state.messages).toEqual(reference.messages);
    expect(state.messages.map((message) => message.id)).toEqual(
      reference.messages.map((message) => message.id),
    );
  });

  it("reads one message per replaced row instead of scanning the whole list", () => {
    const state = createOperationProjectionState([]);
    const callCount = 300;
    for (let call = 0; call < callCount; call += 1) {
      applyOther(state, call * 10);
      applyUpsert(
        state,
        {
          kind: "changes",
          callId: `call-${call}`,
          changes: [{ path: `file-${call}.ts`, kind: "update", diff: "d" }],
          status: "pending",
          turnId: "turn-a",
        },
        call * 10 + 1,
      );
    }
    const messageCount = state.messages.length;
    expect(messageCount).toBe(callCount * 2);

    const legacyReads: number[] = [];
    for (const callId of ["call-0", "call-150", "call-299"]) {
      const copy = createOperationProjectionState([...state.messages]);
      const rows = state.fileEditsByCallId.get(callId) ?? [];
      legacyReads.push(
        countIndexReads(copy, () =>
          legacyReplaceFileEditMessagesForCall(copy, callId, rows),
        ),
      );
    }
    for (const reads of legacyReads) {
      expect(reads).toBeGreaterThanOrEqual(messageCount);
    }

    let newReads = 0;
    for (let call = 0; call < callCount; call += 1) {
      newReads += countIndexReads(state, () =>
        applyUpsert(
          state,
          {
            kind: "changes",
            callId: `call-${call}`,
            changes: [{ path: `file-${call}.ts`, kind: "update", diff: "d2" }],
            status: "completed",
            turnId: "turn-a",
          },
          5_000 + call,
        ),
      );
    }
    expect(newReads).toBe(callCount);
    expect(state.messages).toHaveLength(messageCount);
  });
});

describe("pending file-edit output flush, old walk over every row vs pending keys only", () => {
  interface Pair {
    legacy: OperationProjectionState;
    next: OperationProjectionState;
  }

  function createPair(): Pair {
    return {
      legacy: createOperationProjectionState([]),
      next: createOperationProjectionState([]),
    };
  }

  function applyToPair(pair: Pair, op: Op, seq: number): boolean {
    if (op.kind === "changes" || op.kind === "output") {
      applyUpsert(pair.legacy, op, seq);
      applyUpsert(pair.next, op, seq);
      return false;
    }
    if (op.kind === "other") {
      applyOther(pair.legacy, seq);
      applyOther(pair.next, seq);
      return false;
    }
    legacyFlushPendingFileEditOutput(pair.legacy);
    flushPendingFileEditOutput(pair.next);
    return true;
  }

  it("produces the same rows and buffers after every flush on random sequences", () => {
    let flushesThatChangedOutput = 0;
    for (const seed of [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
      const pair = createPair();
      let seq = 0;
      for (const op of generateOps(seed, 400)) {
        seq += 1;
        const beforeFlush = fileEditStdouts(pair.next);
        if (!applyToPair(pair, op, seq)) {
          continue;
        }
        if (fileEditStdouts(pair.next) !== beforeFlush) {
          flushesThatChangedOutput += 1;
        }
        expect(pair.next.messages).toEqual(pair.legacy.messages);
        expect(pair.next.fileEditStdoutBuffersByScopedCallKey).toEqual(
          pair.legacy.fileEditStdoutBuffersByScopedCallKey,
        );
      }
      applyToPair(pair, { kind: "flush" }, seq + 1);
      expect(pair.next.messages).toEqual(pair.legacy.messages);
    }
    expect(flushesThatChangedOutput).toBeGreaterThan(0);
  });

  it("flushes a call's partial line only on rows of the scope that wrote it", () => {
    const pair = createPair();
    const changes = [{ path: "a.ts", kind: "update", diff: "d" }];
    const ops: Op[] = [
      {
        kind: "changes",
        callId: "call-1",
        changes,
        status: "pending",
        turnId: undefined,
      },
      {
        kind: "changes",
        callId: "call-1",
        changes,
        status: "pending",
        turnId: "turn-a",
      },
      {
        kind: "output",
        callId: "call-1",
        delta: "head\npartial",
        turnId: "turn-a",
      },
      {
        kind: "output",
        callId: "call-1",
        delta: "thread tail",
        turnId: undefined,
      },
      { kind: "flush" },
      { kind: "flush" },
      { kind: "output", callId: "call-1", delta: " more", turnId: "turn-a" },
      { kind: "flush" },
    ];
    for (const [index, op] of ops.entries()) {
      applyToPair(pair, op, index + 1);
      expect(pair.next.messages).toEqual(pair.legacy.messages);
    }
    const stdoutByScope = Object.fromEntries(
      pair.next.messages.flatMap((message) =>
        message.kind === "file-edit"
          ? [[message.scope.kind, message.stdout]]
          : [],
      ),
    );
    expect(stdoutByScope).toEqual({
      thread: "thread tail",
      turn: "head\npartial more",
    });
  });

  it("looks only at calls with an unfinished line, not at every call", () => {
    const pair = createPair();
    const callCount = 300;
    let seq = 0;
    const seedCalls = (target: OperationProjectionState) => {
      for (let call = 0; call < callCount; call += 1) {
        const callId = `call-${call}`;
        upsertFileEdit(target, metaAt((seq += 1)), THREAD_ID, "turn-a", {
          callId,
          changes: [{ path: `file-${call}.ts`, kind: "update", diff: "d" }],
          approvalStatus: null,
          status: "pending",
        });
        upsertFileEdit(target, metaAt((seq += 1)), THREAD_ID, "turn-a", {
          callId,
          stdout: call % 100 === 0 ? "unfinished" : "finished\n",
          appendStdout: true,
          status: "pending",
        });
      }
    };
    seedCalls(pair.legacy);
    seq = 0;
    seedCalls(pair.next);

    const legacyLookups = vi.spyOn(
      pair.legacy.fileEditStdoutBuffersByScopedCallKey,
      "get",
    );
    const nextLookups = vi.spyOn(
      pair.next.fileEditStdoutBuffersByScopedCallKey,
      "get",
    );
    legacyFlushPendingFileEditOutput(pair.legacy);
    flushPendingFileEditOutput(pair.next);

    expect(legacyLookups).toHaveBeenCalledTimes(callCount);
    expect(nextLookups).toHaveBeenCalledTimes(3);
    expect(pair.next.messages).toEqual(pair.legacy.messages);

    nextLookups.mockClear();
    flushPendingFileEditOutput(pair.next);
    expect(nextLookups).not.toHaveBeenCalled();
  });
});
