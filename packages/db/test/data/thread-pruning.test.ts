import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createConnection } from "../../src/connection.js";
import { events, threadPruningCursors, threads } from "../../src/schema.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";
import {
  advanceThreadPruning,
  getNextThreadPruningPolicy,
} from "../../src/data/thread-pruning.js";
import type { ThreadPruningPolicy } from "../../src/data/thread-pruning.js";
import {
  appendDaemonEventsInTransaction,
  pruneResolvedItemDeltas,
  pruneBackgroundTaskProgressEvents,
  getHighWaterMarks,
  deleteThreadEventSuffixInTransaction,
  getLastStoredProviderThreadId,
  getLatestStoredRateLimitsEvent,
  listThreadTurnInterruptionEventStates,
} from "../../src/data/events.js";
import { getThreadEventRewriteGeneration } from "../../src/data/event-rewrite-generation.js";
import { THREAD_CONTEXT_CLEAR_OPERATION, turnScope } from "@bb/domain";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "pruning" });
  const { project } = createProject(db, noopNotifier, {
    name: "pruning",
    source: { type: "local_path", hostId: host.id, path: "/tmp/pruning" },
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  return { db, thread, project };
}

type Fixture = ReturnType<typeof setup>;
function seed(
  f: Fixture,
  sequence: number,
  values: Partial<typeof events.$inferInsert> = {},
) {
  f.db
    .insert(events)
    .values({
      id: `${f.thread.id}-${sequence}`,
      threadId: f.thread.id,
      sequence,
      scopeKind: "turn",
      turnId: "turn",
      type: "provider/rateLimits/updated",
      data: JSON.stringify({ rateLimits: { providerId: "codex" } }),
      createdAt: 1,
      ...values,
    })
    .run();
}
function cycle(f: Fixture, policy: ThreadPruningPolicy) {
  const results = [];
  for (let i = 0; i < 2000; i++) {
    const result = advanceThreadPruning(f.db, policy);
    expect(result.scanned).toBeLessThanOrEqual(500);
    expect(result.removed).toBeLessThanOrEqual(500);
    results.push(result);
    if (result.action === "cycle-complete") return results;
  }
  throw new Error("Pruning did not finish a cycle");
}
function sequences(f: Fixture) {
  return f.db
    .select({ sequence: events.sequence })
    .from(events)
    .where(eq(events.threadId, f.thread.id))
    .orderBy(events.sequence)
    .all()
    .map((r) => r.sequence);
}

describe("thread pruning", () => {
  it("rotates scoped live policies durably and drains active usage without global idle cleanup", () => {
    let f = setup();
    try {
      f.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, f.thread.id))
        .run();
      for (let i = 1; i <= 200; i++) {
        seed(f, i, {
          type: "thread/contextWindowUsage/updated",
          data: JSON.stringify({
            contextWindowUsage: {
              usedTokens: i,
              modelContextWindow: i === 1 ? 200000 : null,
            },
          }),
        });
      }
      seed(f, 201, { type: "turn/completed" });
      const policies = [];
      for (let i = 0; i < 160; i++) {
        const policy = getNextThreadPruningPolicy(f.db, new Set(), f.thread.id);
        if (policy === null) throw new Error("Missing policy");
        policies.push(policy);
        const result = advanceThreadPruning(f.db, { threadId: f.thread.id });
        expect(result.scanned).toBeLessThanOrEqual(32);
        expect(result.removed).toBeLessThanOrEqual(32);
        if (i === 6) {
          const saved = f.db.$client.serialize();
          f.db.$client.close();
          f = { ...f, db: createConnection(saved) };
        }
      }
      expect(policies.slice(0, 8)).toEqual([
        "rate-limits",
        "usage",
        "turn-diffs",
        "resolved-items",
        "rate-limits",
        "usage",
        "turn-diffs",
        "resolved-items",
      ]);
      expect(sequences(f)).toEqual([1, 200, 201]);
      expect(
        f.db
          .select()
          .from(threadPruningCursors)
          .all()
          .every((row) => row.scope === f.thread.id),
      ).toBe(true);
    } finally {
      f.db.$client.close();
    }
  });

  it("reaches resolved deltas beyond unrelated history in one scoped advance", () => {
    const f = setup();
    try {
      f.db.transaction(() => {
        for (let i = 1; i <= 2000; i++)
          seed(f, i, { type: "provider/warning" });
        seed(f, 2001, { type: "item/agentMessage/delta", itemId: "message" });
        seed(f, 2002, { type: "item/agentMessage/delta", itemId: "message" });
        seed(f, 2003, {
          type: "item/completed",
          itemKind: "agentMessage",
          itemId: "message",
        });
      });
      for (let i = 0; i < 3; i++)
        advanceThreadPruning(f.db, { threadId: f.thread.id });
      const result = advanceThreadPruning(f.db, { threadId: f.thread.id });
      expect(result.policy).toBe("resolved-items");
      expect(result.scanned).toBe(2);
      expect(result.removed).toBe(1);
      expect(sequences(f)).toContain(2001);
      expect(sequences(f)).not.toContain(2002);
      expect(sequences(f)).toContain(2003);
    } finally {
      f.db.$client.close();
    }
  });

  it("rolls back scoped live progress and deletion and restores the busy timeout", () => {
    const f = setup();
    try {
      seed(f, 1);
      seed(f, 2);
      f.db.run(
        sql`CREATE TRIGGER fail_live_advance BEFORE UPDATE ON thread_pruning_cursors BEGIN SELECT RAISE(ABORT, 'live advance failed'); END`,
      );
      const generation = getThreadEventRewriteGeneration(f.thread.id);
      expect(() =>
        advanceThreadPruning(f.db, { threadId: f.thread.id }),
      ).toThrow("live advance failed");
      expect(f.db.$client.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(sequences(f)).toEqual([1, 2]);
      expect(f.db.select().from(threadPruningCursors).all()).toEqual([]);
      expect(getThreadEventRewriteGeneration(f.thread.id)).toBe(generation);
      f.db.run(sql`DROP TRIGGER fail_live_advance`);
      expect(
        advanceThreadPruning(f.db, { threadId: f.thread.id }).removed,
      ).toBe(1);
      expect(getThreadEventRewriteGeneration(f.thread.id)).toBe(generation + 1);
    } finally {
      f.db.$client.close();
    }
  });

  it("isolates live progress by thread and preserves global progress on thread deletion", () => {
    const f = setup();
    try {
      const other = {
        ...f,
        thread: createThread(f.db, noopNotifier, {
          projectId: f.project.id,
          providerId: "codex",
        }),
      };
      for (const fixture of [f, other]) {
        fixture.db.transaction(() => {
          for (let i = 1; i <= 600; i++)
            seed(fixture, i, { type: "item/agentMessage/delta" });
        });
        pruneResolvedItemDeltas(f.db, { threadId: fixture.thread.id });
      }
      advanceThreadPruning(f.db, "rate-limits");
      const before = f.db.select().from(threadPruningCursors).all();
      expect(before).toHaveLength(3);
      expect(
        before
          .filter((row) => row.policy === "deltas")
          .map((row) => row.scope)
          .sort(),
      ).toEqual([f.thread.id, other.thread.id].sort());
      pruneResolvedItemDeltas(f.db, { threadId: f.thread.id });
      const remaining = f.db.select().from(threadPruningCursors).all();
      expect(remaining).toEqual(
        before.filter((row) => row.scope !== f.thread.id),
      );
      f.db.delete(threads).where(eq(threads.id, other.thread.id)).run();
      expect(f.db.select().from(threadPruningCursors).all()).toEqual(
        before.filter((row) => row.scope === ""),
      );
    } finally {
      f.db.$client.close();
    }
  });

  it("keeps only the latest thread snapshot across restart and late arrivals", () => {
    let f = setup();
    try {
      f.db.transaction(() => {
        for (let i = 1; i <= 1100; i++)
          seed(f, i, {
            data: JSON.stringify({
              rateLimits: { providerId: "codex" },
            }),
          });
        for (const [i, data] of [
          "{broken",
          "{}",
          '{"rateLimits":{"providerId":3}}',
          '{"rateLimits":{"providerId":""}}',
        ].entries())
          seed(f, 1101 + i, { data });
      });
      advanceThreadPruning(f.db, "rate-limits");
      expect(
        advanceThreadPruning(f.db, "rate-limits").scanned,
      ).toBeLessThanOrEqual(64);
      seed(f, 1105);
      const saved = f.db.$client.serialize();
      f.db.$client.close();
      f = { ...f, db: createConnection(saved) };
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([1105]);
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([1105]);
      expect(
        getLatestStoredRateLimitsEvent(f.db, {
          threadId: f.thread.id,
        })?.sequence,
      ).toBe(1105);
      expect(cycle(f, "rate-limits").reduce((n, r) => n + r.removed, 0)).toBe(
        0,
      );
    } finally {
      f.db.$client.close();
    }
  });

  it("advances live cleanup past retained first deltas and revisits late completions", () => {
    const f = setup();
    try {
      f.db.transaction(() => {
        for (let i = 1; i <= 125; i++) {
          seed(f, i, { type: "item/agentMessage/delta", itemId: `item-${i}` });
          seed(f, 126 + i, {
            type: "item/completed",
            itemKind: "agentMessage",
            itemId: `item-${i}`,
          });
        }
        seed(f, 126, { type: "item/agentMessage/delta", itemId: "item-1" });
        seed(f, 252, { type: "turn/completed" });
      });
      f.db.run(
        sql`CREATE TRIGGER fail_live_insert BEFORE INSERT ON thread_pruning_cursors BEGIN SELECT RAISE(ABORT, 'live insert failed'); END`,
      );
      expect(() =>
        pruneResolvedItemDeltas(f.db, { threadId: f.thread.id }),
      ).toThrow("live insert failed");
      expect(sequences(f)).toContain(126);
      expect(f.db.select().from(threadPruningCursors).all()).toEqual([]);
      f.db.run(sql`DROP TRIGGER fail_live_insert`);
      let removed = 0;
      for (let i = 0; i < 5; i++)
        removed += pruneResolvedItemDeltas(f.db, { threadId: f.thread.id });
      expect(removed).toBe(1);
      expect(sequences(f)).not.toContain(126);
      expect(sequences(f).filter((sequence) => sequence <= 125)).toHaveLength(
        125,
      );
      seed(f, 253, { type: "item/agentMessage/delta", itemId: "late" });
      seed(f, 254, { type: "item/agentMessage/delta", itemId: "late" });
      for (let i = 0; i < 5; i++)
        pruneResolvedItemDeltas(f.db, { threadId: f.thread.id });
      expect(sequences(f)).toContain(254);
      seed(f, 255, {
        type: "item/completed",
        itemKind: "agentMessage",
        itemId: "late",
      });
      for (let i = 0; i < 5; i++)
        pruneResolvedItemDeltas(f.db, { threadId: f.thread.id });
      expect(sequences(f)).toContain(253);
      expect(sequences(f)).not.toContain(254);
    } finally {
      f.db.$client.close();
    }
  });

  it("persists unfinished live probes across restart and rolls progress back with deletion", () => {
    let f = setup();
    try {
      seed(f, 1, {
        type: "item/agentMessage/delta",
        itemId: "reused",
        parentToolCallId: "target",
      });
      seed(f, 2, {
        type: "item/agentMessage/delta",
        itemId: "reused",
        parentToolCallId: "target",
      });
      f.db.transaction(() => {
        for (let i = 3; i <= 1202; i++)
          seed(f, i, {
            type: "item/completed",
            itemKind: "agentMessage",
            itemId: "reused",
            parentToolCallId: `other-${i}`,
          });
        seed(f, 1203, {
          type: "item/completed",
          itemKind: "agentMessage",
          itemId: "reused",
          parentToolCallId: "target",
        });
      });
      expect(pruneResolvedItemDeltas(f.db, { threadId: f.thread.id })).toBe(0);
      const before = f.db.select().from(threadPruningCursors).all();
      expect(before[0]?.probeSequence).toBeGreaterThan(0);
      f.db.run(
        sql`CREATE TRIGGER fail_live_cursor BEFORE UPDATE ON thread_pruning_cursors BEGIN SELECT RAISE(ABORT, 'live cursor failed'); END`,
      );
      expect(() =>
        pruneResolvedItemDeltas(f.db, { threadId: f.thread.id }),
      ).toThrow("live cursor failed");
      expect(f.db.select().from(threadPruningCursors).all()).toEqual(before);
      f.db.run(sql`DROP TRIGGER fail_live_cursor`);
      const saved = f.db.$client.serialize();
      f.db.$client.close();
      f = { ...f, db: createConnection(saved) };
      for (let i = 0; i < 20; i++)
        pruneResolvedItemDeltas(f.db, { threadId: f.thread.id });
      expect(sequences(f)).toContain(1);
      expect(sequences(f)).not.toContain(2);
      f.db.delete(threads).where(eq(threads.id, f.thread.id)).run();
      expect(f.db.select().from(threadPruningCursors).all()).toEqual([]);
    } finally {
      f.db.$client.close();
    }
  });

  it("finishes unarchived cleanup in the background and advances past retained task progress", () => {
    const f = setup();
    try {
      f.db.transaction(() => {
        for (let i = 1; i <= 510; i++)
          seed(f, i, {
            type: "item/backgroundTask/progress",
            itemId: `task-${i}`,
          });
        seed(f, 511, {
          type: "item/backgroundTask/progress",
          itemId: "task-1",
        });
        seed(f, 512, { type: "turn/completed" });
      });
      for (let i = 0; i < 8; i++)
        pruneBackgroundTaskProgressEvents(f.db, { threadId: f.thread.id });
      expect(sequences(f)).not.toContain(1);
      expect(sequences(f)).toContain(511);
      seed(f, 513, { type: "item/agentMessage/delta", itemId: "message" });
      seed(f, 514, { type: "item/agentMessage/delta", itemId: "message" });
      seed(f, 515, {
        type: "item/completed",
        itemId: "message",
        itemKind: "agentMessage",
      });
      cycle(f, "resolved-items");
      expect(sequences(f)).toContain(513);
      expect(sequences(f)).not.toContain(514);
    } finally {
      f.db.$client.close();
    }
  });

  it("prunes oversized snapshots without parsing their payloads", () => {
    const f = setup();
    try {
      const data = JSON.stringify({
        rateLimits: { providerId: "codex" },
        padding: "x".repeat(2 * 1024 * 1024),
      });
      seed(f, 1, { data });
      seed(f, 2, { data });
      const first = advanceThreadPruning(f.db, "rate-limits");
      expect(first.scanned).toBe(2);
      expect(first.removed).toBe(1);
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([2]);
    } finally {
      f.db.$client.close();
    }
  });

  it("rolls back the cursor and deletions together without publishing a rewrite generation", () => {
    const f = setup();
    try {
      seed(f, 1);
      f.db
        .insert(threadPruningCursors)
        .values({ policy: "rate-limits", version: 1, updatedAt: 1 })
        .run();
      seed(f, 2);
      const before = f.db.select().from(threadPruningCursors).all();
      const generation = getThreadEventRewriteGeneration(f.thread.id);
      f.db.run(
        sql`CREATE TRIGGER fail_pruning BEFORE UPDATE ON thread_pruning_cursors BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
      );
      expect(() => advanceThreadPruning(f.db, "rate-limits")).toThrow(
        "injected failure",
      );
      expect(sequences(f)).toEqual([1, 2]);
      expect(f.db.select().from(threadPruningCursors).all()).toEqual(before);
      expect(getThreadEventRewriteGeneration(f.thread.id)).toBe(generation);
      f.db.run(sql`DROP TRIGGER fail_pruning`);
      expect(advanceThreadPruning(f.db, "rate-limits").removed).toBe(1);
      expect(getThreadEventRewriteGeneration(f.thread.id)).toBe(generation + 1);
    } finally {
      f.db.$client.close();
    }
  });

  it("resumes after a competing writer and preserves the current latest snapshot after truncation", () => {
    let f = setup();
    const directory = mkdtempSync(join(tmpdir(), "bb-pruning-concurrent-"));
    const path = join(directory, "fixture.db");
    let writer: ReturnType<typeof createConnection> | undefined;
    try {
      f.db.transaction(() => {
        for (let i = 1; i <= 600; i++) seed(f, i);
      });
      writeFileSync(path, f.db.$client.serialize());
      f.db.$client.close();
      f = { ...f, db: createConnection(path) };
      writer = createConnection(path);
      advanceThreadPruning(f.db, "rate-limits");
      writer.$client.exec("BEGIN IMMEDIATE");
      expect(() =>
        advanceThreadPruning(f.db, { threadId: f.thread.id }),
      ).toThrow("database is locked");
      expect(f.db.$client.pragma("busy_timeout", { simple: true })).toBe(5000);
      expect(() => advanceThreadPruning(f.db, "rate-limits")).toThrow(
        "database is locked",
      );
      expect(f.db.$client.pragma("busy_timeout", { simple: true })).toBe(5000);
      writer.$client.exec("ROLLBACK");
      const batch = advanceThreadPruning(f.db, "rate-limits");
      const nextSurvivor = 599;
      expect(batch.removed).toBeLessThanOrEqual(64);
      writer.delete(events).where(eq(events.sequence, 600)).run();
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([nextSurvivor]);
      expect(
        getLatestStoredRateLimitsEvent(f.db, {
          threadId: f.thread.id,
        })?.sequence,
      ).toBe(nextSurvivor);
    } finally {
      writer?.$client.close();
      f.db.$client.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("revisits new thread IDs behind the traversal cursor", () => {
    const f = setup();
    try {
      seed(f, 1);
      seed(f, 2);
      cycle(f, "rate-limits");
      const added = createThread(f.db, noopNotifier, {
        projectId: f.project.id,
        providerId: "claude",
      });
      f.db
        .update(threads)
        .set({ id: "aaa-pruning" })
        .where(eq(threads.id, added.id))
        .run();
      const newer = { ...f, thread: { ...added, id: "aaa-pruning" } };
      seed(newer, 1);
      seed(newer, 2);
      cycle(f, "rate-limits");
      expect(sequences(newer)).toEqual([2]);
    } finally {
      f.db.$client.close();
    }
  });

  it("retains the latest historical row and skips incoming diffs without allocating sequences", () => {
    const f = setup();
    try {
      seed(f, 1, { type: "turn/started", providerThreadId: "old", data: "{}" });
      seed(f, 2, {
        type: "item/completed",
        itemId: "edit",
        itemKind: "fileChange",
        data: '{"item":{"type":"fileChange","id":"edit","changes":[]}}',
      });
      seed(f, 3, {
        type: "turn/diff/updated",
        providerThreadId: "new",
        data: '{"diff":"large"}',
      });
      cycle(f, "turn-diffs");
      expect(sequences(f)).toEqual([1, 2, 3]);
      expect(getHighWaterMarks(f.db, [f.thread.id])[f.thread.id]).toBe(3);
      expect(getLastStoredProviderThreadId(f.db, f.thread.id)).toBe("new");
      expect(
        listThreadTurnInterruptionEventStates(f.db, {
          threadIds: [f.thread.id],
        })[0]?.latestProviderThreadId,
      ).toBe("new");
      const result = f.db.transaction((tx) =>
        appendDaemonEventsInTransaction(tx, [
          {
            threadId: f.thread.id,
            environmentId: null,
            scope: turnScope("turn"),
            providerThreadId: "newer",
            type: "turn/diff/updated",
            itemId: null,
            itemKind: null,
            parentToolCallId: null,
            data: '{"diff":"never stored"}',
          },
          {
            threadId: f.thread.id,
            environmentId: null,
            scope: turnScope("turn"),
            providerThreadId: "newer",
            type: "item/completed",
            itemId: "edit2",
            itemKind: "fileChange",
            parentToolCallId: null,
            data: '{"item":{"type":"fileChange","id":"edit2","changes":[]}}',
          },
        ]),
      );
      expect(result.acceptedEvents.map((r) => r.sequence)).toEqual([4]);
      expect(result.insertedInputIndexes).toEqual([1]);
      expect(sequences(f)).toEqual([1, 2, 3, 4]);
      expect(getLastStoredProviderThreadId(f.db, f.thread.id)).toBe("newer");
      cycle(f, "turn-diffs");
      expect(sequences(f)).toEqual([1, 2, 4]);
      expect(getHighWaterMarks(f.db, [f.thread.id])[f.thread.id]).toBe(4);
    } finally {
      f.db.$client.close();
    }
  });

  it("preserves the current latest row when resuming after truncation", () => {
    const f = setup();
    try {
      f.db.transaction(() => {
        for (let i = 1; i <= 1200; i++)
          seed(f, i, { type: "turn/diff/updated", data: "{}" });
      });
      expect(advanceThreadPruning(f.db, "turn-diffs").removed).toBe(500);
      f.db.transaction((tx) =>
        deleteThreadEventSuffixInTransaction(tx, {
          threadId: f.thread.id,
          cutoffSequence: 1000,
          oldMaxSequence: 1200,
        }),
      );
      expect(getHighWaterMarks(f.db, [f.thread.id])[f.thread.id]).toBe(999);
      cycle(f, "turn-diffs");
      expect(sequences(f)).toEqual([999]);
      expect(getHighWaterMarks(f.db, [f.thread.id])[f.thread.id]).toBe(999);
    } finally {
      f.db.$client.close();
    }
  });

  it("recovers identity from retained lifecycle events and respects context clearing", () => {
    const f = setup();
    try {
      seed(f, 1, {
        type: "thread/identity",
        providerThreadId: "old",
        data: "{}",
      });
      seed(f, 2, { type: "turn/started", providerThreadId: "old", data: "{}" });
      seed(f, 3, {
        type: "turn/diff/updated",
        providerThreadId: "old",
        data: "{}",
      });
      seed(f, 4, {
        type: "thread/identity",
        providerThreadId: "new",
        data: "{}",
      });
      seed(f, 5, {
        type: "turn/diff/updated",
        providerThreadId: "new",
        data: "{}",
      });
      seed(f, 6, {
        type: "turn/completed",
        providerThreadId: "new",
        data: "{}",
      });
      seed(f, 7, { type: "system/error", providerThreadId: null, data: "{}" });
      cycle(f, "turn-diffs");
      expect(sequences(f)).toEqual([1, 2, 4, 6, 7]);
      expect(getLastStoredProviderThreadId(f.db, f.thread.id)).toBe("new");
      expect(
        listThreadTurnInterruptionEventStates(f.db, {
          threadIds: [f.thread.id],
        })[0]?.latestProviderThreadId,
      ).toBe("new");
      seed(f, 8, {
        type: "system/operation",
        data: JSON.stringify({
          operation: THREAD_CONTEXT_CLEAR_OPERATION,
          status: "completed",
        }),
      });
      expect(getLastStoredProviderThreadId(f.db, f.thread.id)).toBeNull();
      seed(f, 9, {
        type: "thread/identity",
        providerThreadId: "replacement",
        data: "{}",
      });
      expect(getLastStoredProviderThreadId(f.db, f.thread.id)).toBe(
        "replacement",
      );
    } finally {
      f.db.$client.close();
    }
  });

  it("drains more than 500 resolved deltas and preserves scope, first-delta and output guards", () => {
    const f = setup();
    try {
      f.db
        .update(threads)
        .set({ archivedAt: 1 })
        .where(eq(threads.id, f.thread.id))
        .run();
      f.db.transaction(() => {
        for (let i = 1; i <= 1200; i++)
          seed(f, i, {
            type: "item/commandExecution/outputDelta",
            itemId: "cmd",
            itemKind: "commandExecution",
            data: '{"delta":"x"}',
          });
        seed(f, 1201, {
          type: "item/completed",
          itemId: "cmd",
          itemKind: "commandExecution",
          data: '{"item":{"aggregatedOutput":"x"}}',
        });
        seed(f, 1202, {
          type: "item/commandExecution/outputDelta",
          itemId: "cmd",
          turnId: "other",
          data: '{"delta":"keep"}',
        });
        seed(f, 1203, {
          type: "item/commandExecution/outputDelta",
          itemId: "cmd",
          parentToolCallId: "nested",
          data: '{"delta":"keep"}',
        });
        for (let i = 1204; i <= 1205; i++)
          seed(f, i, {
            type: "item/commandExecution/outputDelta",
            itemId: "no-output",
            data: '{"delta":"keep"}',
          });
        seed(f, 1206, {
          type: "item/completed",
          itemId: "no-output",
          itemKind: "commandExecution",
          data: '{"item":{}}',
        });
      });
      cycle(f, "resolved-items");
      expect(sequences(f)).toEqual([1, 1201, 1202, 1203, 1204, 1205, 1206]);
    } finally {
      f.db.$client.close();
    }
  });

  it("rechecks archive status and the latest-event safeguard between rate batches", () => {
    const f = setup();
    try {
      for (let i = 1; i <= 130; i++) seed(f, i);
      seed(f, 131, { type: "turn/completed" });
      f.db
        .update(threads)
        .set({ archivedAt: 1 })
        .where(eq(threads.id, f.thread.id))
        .run();
      expect(advanceThreadPruning(f.db, "rate-limits").removed).toBe(64);
      f.db
        .update(threads)
        .set({ archivedAt: null })
        .where(eq(threads.id, f.thread.id))
        .run();
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([130, 131]);
      f.db
        .update(threads)
        .set({ archivedAt: 2 })
        .where(eq(threads.id, f.thread.id))
        .run();
      f.db.delete(events).where(eq(events.sequence, 131)).run();
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([130]);
      seed(f, 131, { type: "turn/completed" });
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([131]);
    } finally {
      f.db.$client.close();
    }
  });

  it.each([null, 1])(
    "keeps only root usage and capacity witnesses with archivedAt=%s",
    (archivedAt) => {
      const f = setup();
      try {
        f.db
          .update(threads)
          .set({ archivedAt })
          .where(eq(threads.id, f.thread.id))
          .run();
        for (let sequence = 1; sequence <= 6; sequence++) {
          seed(f, sequence, {
            type: "thread/contextWindowUsage/updated",
            data: JSON.stringify({
              contextWindowUsage: {
                usedTokens: sequence * 100,
                modelContextWindow: sequence === 2 ? 200000 : null,
              },
            }),
          });
          seed(f, sequence + 6, {
            type: "thread/tokenUsage/updated",
            data: JSON.stringify({
              tokenUsage: {
                modelContextWindow: sequence === 1 ? 200000 : null,
              },
            }),
          });
        }
        seed(f, 13, {
          type: "turn/started",
          turnId: "nested",
          parentToolCallId: "parent",
        });
        seed(f, 14, {
          type: "thread/contextWindowUsage/updated",
          turnId: "nested",
          data: '{"contextWindowUsage":{"modelContextWindow":1000}}',
        });
        seed(f, 15, { type: "thread/tokenUsage/updated", turnId: "nested" });
        cycle(f, "usage");
        expect(sequences(f)).toEqual([2, 6, 12, 13, 15]);
        seed(f, 16, { type: "turn/completed" });
        cycle(f, "usage");
        expect(sequences(f)).toEqual([2, 6, 12, 13, 16]);
      } finally {
        f.db.$client.close();
      }
    },
  );

  it("restarts usage keeper discovery after a keeper disappears during a visit", () => {
    const f = setup();
    try {
      f.db
        .update(threads)
        .set({ archivedAt: 1 })
        .where(eq(threads.id, f.thread.id))
        .run();
      f.db.transaction(() => {
        for (let i = 1; i <= 600; i++)
          seed(f, i, {
            type: "thread/contextWindowUsage/updated",
            data: JSON.stringify({
              contextWindowUsage: {
                modelContextWindow: i === 1 ? 200000 : null,
              },
            }),
          });
        seed(f, 1000, {
          type: "system/error",
          scopeKind: "thread",
          turnId: null,
          data: "{}",
        });
      });
      advanceThreadPruning(f.db, "usage");
      advanceThreadPruning(f.db, "usage");
      f.db.delete(events).where(eq(events.sequence, 600)).run();
      expect(advanceThreadPruning(f.db, "usage").removed).toBe(0);
      cycle(f, "usage");
      cycle(f, "usage");
      expect(sequences(f)).toEqual([1, 599, 1000]);
    } finally {
      f.db.$client.close();
    }
  });

  it("revisits deltas whose completion arrives after their candidate window", () => {
    const f = setup();
    try {
      f.db
        .update(threads)
        .set({ archivedAt: 1 })
        .where(eq(threads.id, f.thread.id))
        .run();
      f.db.transaction(() => {
        for (let i = 1; i <= 800; i++)
          seed(f, i, {
            type: "item/agentMessage/delta",
            itemId: "late",
            data: '{"delta":"part"}',
          });
      });
      for (let i = 0; i < 10; i++) {
        const result = advanceThreadPruning(f.db, "resolved-items");
        if (result.scanned > 0) break;
      }
      seed(f, 801, {
        type: "item/completed",
        itemId: "late",
        itemKind: "agentMessage",
        data: '{"item":{"text":"complete"}}',
      });
      cycle(f, "resolved-items");
      expect(sequences(f)).toContain(1);
      cycle(f, "resolved-items");
      expect(sequences(f)).toEqual([1, 801]);
    } finally {
      f.db.$client.close();
    }
  });

  it("resumes bounded support probes through adversarial reused-item scopes", () => {
    let f = setup();
    try {
      f.db
        .update(threads)
        .set({ archivedAt: 1 })
        .where(eq(threads.id, f.thread.id))
        .run();
      seed(f, 1, {
        type: "item/agentMessage/delta",
        itemId: "reused",
        parentToolCallId: "target",
      });
      seed(f, 2, {
        type: "item/agentMessage/delta",
        itemId: "reused",
        parentToolCallId: "target",
      });
      f.db.transaction(() => {
        for (let i = 3; i <= 1202; i++)
          seed(f, i, {
            type: "item/completed",
            itemId: "reused",
            itemKind: "agentMessage",
            parentToolCallId: `other-${i}`,
            data: '{"item":{"text":"unrelated"}}',
          });
        seed(f, 1203, {
          type: "item/completed",
          itemId: "reused",
          itemKind: "agentMessage",
          parentToolCallId: "target",
          data: '{"item":{"text":"complete"}}',
        });
      });
      let pending = false;
      for (let i = 0; i < 30; i++) {
        advanceThreadPruning(f.db, "resolved-items");
        if (
          f.db
            .select()
            .from(threadPruningCursors)
            .all()
            .some((row) => row.probeEventId !== null && row.probeSequence > 0)
        ) {
          pending = true;
          break;
        }
      }
      expect(pending).toBe(true);
      const saved = f.db.$client.serialize();
      f.db.$client.close();
      f = { ...f, db: createConnection(saved) };
      expect(sequences(f)).toContain(2);
      const results = cycle(f, "resolved-items");
      expect(results.reduce((sum, r) => sum + r.removed, 0)).toBe(1);
      expect(sequences(f)).toContain(1);
      expect(sequences(f)).not.toContain(2);
    } finally {
      f.db.$client.close();
    }
  });

  it("cycles past disappeared threads and resets independent versioned policies", () => {
    const f = setup();
    try {
      for (let i = 1; i <= 501; i++) seed(f, i);
      advanceThreadPruning(f.db, "rate-limits");
      f.db.delete(threads).where(eq(threads.id, f.thread.id)).run();
      expect(advanceThreadPruning(f.db, "rate-limits").action).toBe(
        "missing-thread",
      );
      cycle(f, "rate-limits");
      f.db
        .update(threadPruningCursors)
        .set({ version: 0, lastThreadId: "zzz" })
        .run();
      cycle(f, "rate-limits");
      expect(f.db.select().from(threadPruningCursors).get()?.version).toBe(1);
      expect(f.db.select().from(threadPruningCursors).all()).toHaveLength(1);
      cycle(f, "turn-diffs");
      expect(f.db.select().from(threadPruningCursors).all()).toHaveLength(2);
    } finally {
      f.db.$client.close();
    }
  });
});
