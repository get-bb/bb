import { performance } from "node:perf_hooks";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";
import type { DbConnection } from "../../src/connection.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import { deleteThreadEventSuffixInTransaction } from "../../src/data/events.js";
import {
  THREAD_PRUNING_ADVANCE_WORK_BUDGET_MS,
  advanceThreadPruning,
} from "../../src/data/thread-pruning.js";
import { noopNotifier } from "../../src/notifier.js";
import { markThreadPruningWork } from "../../src/data/thread-pruning-work.js";
import { events, threadPruningCursors } from "../../src/schema.js";
import { createMigratedConnection } from "../../src/testing.js";

interface Fixture {
  db: DbConnection;
  threadId: string;
}

interface RowSpec {
  type: ThreadEventType;
  turnId?: string | null;
  itemId?: string | null;
  itemKind?: ThreadEventItemType | null;
  parentToolCallId?: string | null;
  data?: Record<string, unknown>;
}

const DELTA_BY_KIND = {
  agentMessage: "item/agentMessage/delta",
  commandExecution: "item/commandExecution/outputDelta",
  reasoning: "item/reasoning/textDelta",
} as const;

type TextKind = keyof typeof DELTA_BY_KIND;

function setup(): Fixture {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "resume" });
  const { project } = createProject(db, noopNotifier, {
    name: "resume",
    source: { type: "local_path", hostId: host.id, path: "/tmp/resume" },
  });
  const thread = createThread(db, noopNotifier, {
    status: "idle",
    projectId: project.id,
    providerId: "codex",
  });
  return { db, threadId: thread.id };
}

function insertRow(f: Fixture, sequence: number, spec: RowSpec): void {
  f.db
    .insert(events)
    .values({
      id: `${f.threadId}-${sequence}`,
      threadId: f.threadId,
      sequence,
      scopeKind: spec.turnId === null ? "thread" : "turn",
      turnId: spec.turnId === undefined ? "turn-1" : spec.turnId,
      type: spec.type,
      itemId: spec.itemId ?? null,
      itemKind: spec.itemKind ?? null,
      parentToolCallId: spec.parentToolCallId ?? null,
      data: JSON.stringify(spec.data ?? {}),
      createdAt: sequence,
    })
    .run();
}

function delta(kind: TextKind, itemId: string, turnId = "turn-1"): RowSpec {
  return { type: DELTA_BY_KIND[kind], itemId, turnId };
}

function completion(
  kind: TextKind,
  itemId: string,
  turnId = "turn-1",
  withOutput = true,
): RowSpec {
  return {
    type: "item/completed",
    itemId,
    itemKind: kind,
    turnId,
    data: { item: withOutput ? { aggregatedOutput: "done" } : {} },
  };
}

function marker(): RowSpec {
  return { type: "turn/started", turnId: "marker" };
}

function sequences(f: Fixture): number[] {
  return f.db
    .select({ sequence: events.sequence })
    .from(events)
    .where(eq(events.threadId, f.threadId))
    .orderBy(events.sequence)
    .all()
    .map((row) => row.sequence);
}

function forgetFinishedResolvedItemPasses(f: Fixture): void {
  const cursors = f.db
    .select()
    .from(threadPruningCursors)
    .where(
      and(
        eq(threadPruningCursors.scope, f.threadId),
        inArray(threadPruningCursors.policy, ["deltas", "background"]),
      ),
    )
    .all();
  for (const cursor of cursors)
    if (cursor.sequence >= cursor.upperSequence)
      f.db
        .delete(threadPruningCursors)
        .where(
          and(
            eq(threadPruningCursors.scope, f.threadId),
            eq(threadPruningCursors.policy, cursor.policy),
          ),
        )
        .run();
}

function resolvedItemsPass(f: Fixture) {
  let scanned = 0;
  let removed = 0;
  for (let call = 0; call < 200; call += 1) {
    const result = advanceThreadPruning(f.db, { threadId: f.threadId });
    if (result.policy !== "resolved-items") continue;
    scanned += result.scanned;
    removed += result.removed;
    if (result.action === "thread-complete") return { scanned, removed };
  }
  throw new Error("Resolved-item pass did not finish");
}

function drain(f: Fixture, rescan: boolean): void {
  for (let pass = 0; pass < 4; pass += 1) {
    if (rescan) forgetFinishedResolvedItemPasses(f);
    resolvedItemsPass(f);
  }
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolved-item pruning passes", () => {
  it("resumes after the rows an earlier pass settled instead of rescanning them", () => {
    const f = setup();
    try {
      let sequence = 0;
      for (let item = 0; item < 40; item += 1) {
        insertRow(f, ++sequence, delta("agentMessage", `kept-${item}`));
        insertRow(f, ++sequence, completion("agentMessage", `kept-${item}`));
      }
      insertRow(f, ++sequence, marker());
      expect(resolvedItemsPass(f)).toEqual({ scanned: 40, removed: 0 });

      for (let index = 0; index < 3; index += 1)
        insertRow(f, ++sequence, delta("agentMessage", "fresh"));
      insertRow(f, ++sequence, completion("agentMessage", "fresh"));
      insertRow(f, ++sequence, marker());

      expect(resolvedItemsPass(f)).toEqual({ scanned: 3, removed: 2 });
    } finally {
      f.db.$client.close();
    }
  });

  it("prunes deltas a finished pass already passed once their item completes later", () => {
    const f = setup();
    try {
      let sequence = 0;
      for (let index = 0; index < 5; index += 1)
        insertRow(f, ++sequence, delta("reasoning", "slow"));
      insertRow(f, ++sequence, marker());
      expect(resolvedItemsPass(f).removed).toBe(0);

      insertRow(f, ++sequence, completion("reasoning", "slow"));
      insertRow(f, ++sequence, marker());
      expect(resolvedItemsPass(f).removed).toBe(4);
      expect(sequences(f)).toEqual([1, 6, 7, 8]);
    } finally {
      f.db.$client.close();
    }
  });

  it("scans sequences again after a suffix delete lets new rows reuse them", () => {
    const f = setup();
    try {
      let sequence = 0;
      for (let index = 0; index < 6; index += 1)
        insertRow(f, ++sequence, marker());
      expect(resolvedItemsPass(f).removed).toBe(0);

      f.db.transaction((tx) =>
        deleteThreadEventSuffixInTransaction(tx, {
          threadId: f.threadId,
          cutoffSequence: 3,
          oldMaxSequence: sequence,
        }),
      );
      sequence = 2;
      for (let index = 0; index < 2; index += 1)
        insertRow(f, ++sequence, delta("agentMessage", "rewritten"));
      insertRow(f, ++sequence, completion("agentMessage", "rewritten"));
      insertRow(f, ++sequence, marker());
      insertRow(f, ++sequence, marker());

      expect(resolvedItemsPass(f).removed).toBe(1);
      expect(sequences(f)).toEqual([1, 2, 3, 5, 6, 7]);
    } finally {
      f.db.$client.close();
    }
  });

  it("stops an advance at its time budget and still removes the same rows", () => {
    const seedRows = (f: Fixture) => {
      let sequence = 0;
      for (let item = 0; item < 30; item += 1) {
        for (let index = 0; index < 4; index += 1)
          insertRow(f, ++sequence, delta("commandExecution", `cmd-${item}`));
        insertRow(f, ++sequence, completion("commandExecution", `cmd-${item}`));
      }
      insertRow(f, ++sequence, marker());
    };
    const unbudgeted = setup();
    const budgeted = setup();
    try {
      seedRows(unbudgeted);
      seedRows(budgeted);
      const reference = resolvedItemsPass(unbudgeted);

      let clock = 0;
      vi.spyOn(performance, "now").mockImplementation(() => (clock += 1));
      const advances: number[] = [];
      for (let call = 0; call < 400; call += 1) {
        const result = advanceThreadPruning(budgeted.db, {
          threadId: budgeted.threadId,
        });
        if (result.policy !== "resolved-items") continue;
        advances.push(result.scanned);
        if (result.action === "thread-complete") break;
      }

      expect(advances.length).toBeGreaterThan(2);
      expect(Math.max(...advances)).toBeLessThan(
        THREAD_PRUNING_ADVANCE_WORK_BUDGET_MS,
      );
      expect(sequences(budgeted)).toEqual(sequences(unbudgeted));
      expect(reference.removed).toBe(90);
    } finally {
      unbudgeted.db.$client.close();
      budgeted.db.$client.close();
    }
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "keeps the same rows as rescanning every pass from the start (seed %i)",
    (seed) => {
      const random = createRandom(seed);
      const resumed = setup();
      const rescanned = setup();
      const fixtures = [resumed, rescanned];
      try {
        let sequence = 0;
        const openItems: { id: string; kind: TextKind; turnId: string }[] = [];
        const openTasks: string[] = [];
        let nextItem = 0;
        const append = (spec: RowSpec) => {
          sequence += 1;
          for (const f of fixtures) {
            insertRow(f, sequence, spec);
            markThreadPruningWork(f.db, [f.threadId]);
          }
        };
        const advance = (scope: "live" | "sweep") => {
          for (const f of fixtures) {
            if (f === rescanned) forgetFinishedResolvedItemPasses(f);
            if (scope === "live")
              advanceThreadPruning(f.db, { threadId: f.threadId });
            else advanceThreadPruning(f.db, "resolved-items");
          }
        };
        for (let step = 0; step < 400; step += 1) {
          const roll = random();
          if (roll < 0.12 || openItems.length === 0) {
            const kinds = Object.keys(DELTA_BY_KIND) as TextKind[];
            openItems.push({
              id: `item-${nextItem++}`,
              kind: kinds[Math.floor(random() * kinds.length)]!,
              turnId: `turn-${1 + Math.floor(random() * 3)}`,
            });
          } else if (roll < 0.55) {
            const item = openItems[Math.floor(random() * openItems.length)]!;
            append(delta(item.kind, item.id, item.turnId));
          } else if (roll < 0.66) {
            const index = Math.floor(random() * openItems.length);
            const item = openItems[index]!;
            openItems.splice(index, 1);
            append(completion(item.kind, item.id, item.turnId, random() < 0.8));
          } else if (roll < 0.74) {
            const taskId =
              openTasks.length === 0 || random() < 0.3
                ? `task-${nextItem++}`
                : openTasks[Math.floor(random() * openTasks.length)]!;
            if (!openTasks.includes(taskId)) openTasks.push(taskId);
            append({
              type: "item/backgroundTask/progress",
              itemId: taskId,
              itemKind: "backgroundTask",
              turnId: null,
            });
          } else if (roll < 0.77 && openTasks.length > 0) {
            const taskId = openTasks.shift()!;
            append({
              type: "item/backgroundTask/completed",
              itemId: taskId,
              itemKind: "backgroundTask",
              turnId: null,
            });
          } else if (roll < 0.79 && sequence > 10) {
            append(marker());
            drain(resumed, false);
            drain(rescanned, true);
            expect(sequences(resumed)).toEqual(sequences(rescanned));
            const cutoff = sequence - Math.floor(random() * 8);
            for (const f of fixtures)
              f.db.transaction((tx) =>
                deleteThreadEventSuffixInTransaction(tx, {
                  threadId: f.threadId,
                  cutoffSequence: cutoff,
                  oldMaxSequence: sequence,
                }),
              );
            sequence = cutoff - 1;
          } else if (roll < 0.92) {
            advance("live");
          } else {
            advance("sweep");
          }
        }
        append(marker());
        drain(resumed, false);
        drain(rescanned, true);
        expect(sequences(resumed)).toEqual(sequences(rescanned));
        expect(sequences(resumed).length).toBeLessThan(sequence);
      } finally {
        resumed.db.$client.close();
        rescanned.db.$client.close();
      }
    },
  );
});
