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
import { advanceThreadPruning } from "../../src/data/thread-pruning.js";
import type { ThreadPruningPolicy } from "../../src/data/thread-pruning.js";
import {
  appendDaemonEventsInTransaction,
  getHighWaterMarks,
  getLastStoredProviderThreadId,
  getLatestStoredRateLimitsEventForProvider,
  listThreadTurnInterruptionEventStates,
} from "../../src/data/events.js";
import { getThreadEventRewriteGeneration } from "../../src/data/event-rewrite-generation.js";
import { turnScope } from "@bb/domain";
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
  for (let i = 0; i < 200; i++) {
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
  it("keeps the latest provider snapshots and malformed identities across restart and late arrivals", () => {
    let f = setup();
    try {
      f.db.transaction(() => {
        for (let i = 1; i <= 1100; i++)
          seed(f, i, {
            data: JSON.stringify({
              rateLimits: { providerId: i % 2 ? "codex" : "claude" },
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
      expect(advanceThreadPruning(f.db, "rate-limits").removed).toBe(494);
      seed(f, 1105);
      const saved = f.db.$client.serialize();
      f.db.$client.close();
      f = { ...f, db: createConnection(saved) };
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([1099, 1100, 1101, 1102, 1103, 1104, 1105]);
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([1100, 1101, 1102, 1103, 1104, 1105]);
      expect(
        getLatestStoredRateLimitsEventForProvider(f.db, {
          threadId: f.thread.id,
          providerId: "codex",
        })?.sequence,
      ).toBe(1105);
      expect(cycle(f, "rate-limits").reduce((n, r) => n + r.removed, 0)).toBe(
        0,
      );
    } finally {
      f.db.$client.close();
    }
  });

  it("rolls back the cursor and deletions together without publishing a rewrite generation", () => {
    const f = setup();
    try {
      seed(f, 1);
      seed(f, 2);
      advanceThreadPruning(f.db, "rate-limits");
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

  it("resumes after a competing writer and revalidates a deleted rate-limit witness", () => {
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
      expect(() => advanceThreadPruning(f.db, "rate-limits")).toThrow(
        "database is locked",
      );
      expect(f.db.$client.pragma("busy_timeout", { simple: true })).toBe(5000);
      writer.$client.exec("ROLLBACK");
      expect(advanceThreadPruning(f.db, "rate-limits").removed).toBe(499);
      writer.delete(events).where(eq(events.sequence, 600)).run();
      cycle(f, "rate-limits");
      expect(sequences(f)).toEqual([100]);
      expect(
        getLatestStoredRateLimitsEventForProvider(f.db, {
          threadId: f.thread.id,
          providerId: "codex",
        })?.sequence,
      ).toBe(100);
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

  it("removes every historical diff, retains edit events and preserves allocation and provider recovery", () => {
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
      expect(sequences(f)).toEqual([1, 2]);
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
      expect(result.acceptedEvents.map((r) => r.sequence)).toEqual([4, 5]);
      expect(sequences(f)).toEqual([1, 2, 5]);
      expect(getLastStoredProviderThreadId(f.db, f.thread.id)).toBe("newer");
      expect(cycle(f, "turn-diffs").every((r) => r.removed === 0)).toBe(true);
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
      cycle(f, "archive");
      expect(sequences(f)).toEqual([1, 1201, 1202, 1203, 1204, 1205, 1206]);
    } finally {
      f.db.$client.close();
    }
  });

  it("rechecks archive status between batches and revisits newly archived and late rows", () => {
    const f = setup();
    try {
      f.db.transaction(() => {
        for (let i = 1; i <= 1100; i++)
          seed(f, i, { type: "turn/diff/updated", data: "{}" });
      });
      f.db
        .update(threads)
        .set({ archivedAt: 1 })
        .where(eq(threads.id, f.thread.id))
        .run();
      let result;
      do {
        result = advanceThreadPruning(f.db, "archive");
      } while (result.removed === 0);
      expect(result.removed).toBe(500);
      f.db
        .update(threads)
        .set({ archivedAt: null })
        .where(eq(threads.id, f.thread.id))
        .run();
      expect(advanceThreadPruning(f.db, "archive").action).toBe("unarchived");
      expect(sequences(f)).toHaveLength(600);
      cycle(f, "archive");
      f.db
        .update(threads)
        .set({ archivedAt: 2 })
        .where(eq(threads.id, f.thread.id))
        .run();
      cycle(f, "archive");
      expect(sequences(f)).toHaveLength(120);
      expect(sequences(f)[0]).toBe(981);
    } finally {
      f.db.$client.close();
    }
  });

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
      advanceThreadPruning(f.db, "archive");
      advanceThreadPruning(f.db, "archive");
      f.db.delete(events).where(eq(events.sequence, 600)).run();
      expect(advanceThreadPruning(f.db, "archive").removed).toBe(0);
      cycle(f, "archive");
      cycle(f, "archive");
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
        const result = advanceThreadPruning(f.db, "archive");
        if (result.cursor.step === 5 && result.cursor.sequence === 500) break;
      }
      seed(f, 801, {
        type: "item/completed",
        itemId: "late",
        itemKind: "agentMessage",
        data: '{"item":{"text":"complete"}}',
      });
      cycle(f, "archive");
      expect(sequences(f)).toHaveLength(501);
      cycle(f, "archive");
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
        const result = advanceThreadPruning(f.db, "archive");
        if (
          result.cursor.probeEventId !== null &&
          result.cursor.probeSequence > 0
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
      const results = cycle(f, "archive");
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
