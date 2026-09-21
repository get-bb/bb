import { performance } from "node:perf_hooks";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  advanceThreadPruning,
  events,
  getNextThreadPruningPolicy,
  getThreadEventRewriteGeneration,
  threadPruningCursors,
  threads,
} from "@bb/db";
import { runThreadPruningSweep } from "../../src/services/system/thread-pruning-sweep.js";
import {
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seed(harness: TestAppHarness, count: number) {
  const host = seedHost(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const thread = seedThread(harness.deps, { projectId: project.id });
  harness.db.transaction((tx) => {
    for (let sequence = 1; sequence <= count; sequence++)
      tx.insert(events)
        .values({
          id: `${thread.id}-${sequence}`,
          threadId: thread.id,
          sequence,
          scopeKind: "turn",
          turnId: "turn",
          type: "turn/diff/updated",
          data: '{"diff":"unused"}',
          createdAt: 1,
        })
        .run();
  });
  return thread;
}

describe("thread pruning sweep", () => {
  it("skips busy work and rechecks activity after a committed notification", async () => {
    await withTestHarness(async (harness) => {
      const thread = seed(harness, 1200);
      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, thread.id))
        .run();
      await runThreadPruningSweep(harness.deps);
      expect(harness.db.select().from(threadPruningCursors).all()).toEqual([]);
      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, thread.id))
        .run();
      const generation = getThreadEventRewriteGeneration(thread.id);
      const notify = vi
        .spyOn(harness.deps.hub, "notifyThread")
        .mockImplementation((id, changes) => {
          if (id === thread.id && changes.includes("history-rewritten")) {
            expect(getThreadEventRewriteGeneration(id)).toBeGreaterThan(
              generation,
            );
            expect(harness.db.select().from(events).all()).toHaveLength(700);
            harness.db
              .update(threads)
              .set({ status: "active" })
              .where(eq(threads.id, thread.id))
              .run();
          }
        });
      await runThreadPruningSweep(harness.deps);
      expect(notify).toHaveBeenCalledExactlyOnceWith(thread.id, [
        "history-rewritten",
      ]);
      expect(harness.db.select().from(events).all()).toHaveLength(700);
      notify.mockRestore();
    });
  });

  it("keeps notifications for earlier commits when the next transaction fails, then resumes", async () => {
    await withTestHarness(async (harness) => {
      const thread = seed(harness, 1200);
      const notify = vi
        .spyOn(harness.deps.hub, "notifyThread")
        .mockImplementation((_id, changes) => {
          if (changes.includes("history-rewritten"))
            harness.db.run(
              sql`CREATE TRIGGER fail_next_prune BEFORE UPDATE ON thread_pruning_cursors BEGIN SELECT RAISE(ABORT, 'next batch failed'); END`,
            );
        });
      await expect(runThreadPruningSweep(harness.deps)).rejects.toThrow(
        "next batch failed",
      );
      expect(notify).toHaveBeenCalledExactlyOnceWith(thread.id, [
        "history-rewritten",
      ]);
      expect(harness.db.select().from(events).all()).toHaveLength(700);
      harness.db.run(sql`DROP TRIGGER fail_next_prune`);
      notify.mockRestore();
      for (let i = 0; i < 3; i++) await runThreadPruningSweep(harness.deps);
      expect(
        harness.db
          .select()
          .from(events)
          .all()
          .map((row) => row.sequence),
      ).toEqual([1200]);
    });
  });

  it("stops at the elapsed budget between advances", async () => {
    await withTestHarness(async (harness) => {
      seed(harness, 1200);
      let elapsed = 0;
      const now = vi
        .spyOn(performance, "now")
        .mockImplementation(() => elapsed);
      const debug = vi
        .spyOn(harness.deps.logger, "debug")
        .mockImplementation((_fields, message) => {
          if (message === "Thread pruning policy advanced") elapsed = 51;
        });
      try {
        await runThreadPruningSweep(harness.deps);
        expect(
          debug.mock.calls.filter(
            (call) => call[1] === "Thread pruning policy advanced",
          ),
        ).toHaveLength(1);
      } finally {
        now.mockRestore();
        debug.mockRestore();
      }
    });
  });

  it("reports an advance that overruns the elapsed budget and then yields", async () => {
    await withTestHarness(async (harness) => {
      seed(harness, 1200);
      const now = vi
        .spyOn(performance, "now")
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(0)
        .mockReturnValue(75);
      const warn = vi.spyOn(harness.deps.logger, "warn");
      const debug = vi.spyOn(harness.deps.logger, "debug");
      try {
        await runThreadPruningSweep(harness.deps);
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ advanceElapsedMs: 75 }),
          "Slow thread pruning advance",
        );
        expect(debug).toHaveBeenCalledWith(
          expect.objectContaining({
            advances: 1,
            maxAdvanceMs: 75,
            reason: "budget",
          }),
          "Thread pruning sweep finished",
        );
      } finally {
        now.mockRestore();
        warn.mockRestore();
        debug.mockRestore();
      }
    });
  });

  it("rotates durable policy progress and honors the advance budget", async () => {
    await withTestHarness(async (harness) => {
      const first = seed(harness, 0);
      for (let i = 0; i < 100; i++)
        seedThread(harness.deps, { projectId: first.projectId });
      const debug = vi.spyOn(harness.deps.logger, "debug");
      await runThreadPruningSweep(harness.deps);
      const steps = debug.mock.calls.filter(
        (call) => call[1] === "Thread pruning policy advanced",
      );
      expect(steps.length).toBeLessThanOrEqual(64);
      expect(harness.db.select().from(threadPruningCursors).all()).toHaveLength(
        4,
      );
      const before = getNextThreadPruningPolicy(harness.db, new Set());
      expect(before).not.toBeNull();
      if (before === null) throw new Error("Missing next policy");
      advanceThreadPruning(harness.db, before);
      expect(getNextThreadPruningPolicy(harness.db, new Set())).not.toBe(
        before,
      );
      debug.mockRestore();
    });
  });
});
