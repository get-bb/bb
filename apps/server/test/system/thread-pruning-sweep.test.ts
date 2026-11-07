import { performance } from "node:perf_hooks";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  advanceThreadPruning,
  events,
  insertEvents,
  listSweepItemFailures,
  noopNotifier,
  getNextThreadPruningPolicy,
  getThreadEventRewriteGeneration,
  pendingInteractions,
  threadPruningCursors,
  threads,
} from "@bb/db";
import {
  applyThreadTimelineDelta,
  isThreadTimelineDelta,
  threadTimelineReadResponseSchema,
  type ThreadTimelineResponse,
} from "@bb/server-contract";
import {
  threadPruningSweep,
  THREAD_PRUNING_SWEEP_LIMITS,
  type ThreadPruningSweepLimits,
} from "../../src/services/system/thread-pruning-sweep.js";
import {
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seed(harness: TestAppHarness, count: number) {
  const host = seedHost(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const thread = seedThread(harness.deps, { projectId: project.id });
  insertEvents(
    harness.db,
    noopNotifier,
    Array.from({ length: count }, (_, index) => ({
      threadId: thread.id,
      sequence: index + 1,
      scope: { kind: "turn", turnId: "turn" },
      type: "turn/diff/updated",
      itemId: null,
      itemKind: null,
      parentToolCallId: null,
      data: '{"diff":"unused"}',
      createdAt: 1,
    })),
  );
  return thread;
}

async function getTimeline(
  harness: TestAppHarness,
  threadId: string,
  held?: ThreadTimelineResponse,
): Promise<ThreadTimelineResponse> {
  const query = held === undefined ? "" : `?afterTag=${held.tag}`;
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/timeline${query}`,
  );
  expect(response.status).toBe(200);
  const body = threadTimelineReadResponseSchema.parse(await readJson(response));
  if (!isThreadTimelineDelta(body)) {
    return body;
  }
  const applied =
    held === undefined ? null : applyThreadTimelineDelta(held, body);
  if (applied === null) {
    throw new Error("timeline delta did not apply to the held window");
  }
  return applied;
}

function removedEvents(fields: unknown): boolean {
  return (
    typeof fields === "object" &&
    fields !== null &&
    "removed" in fields &&
    fields.removed !== 0
  );
}

function setThreadStatus(
  harness: TestAppHarness,
  threadId: string,
  status: "active" | "idle" | "starting",
) {
  harness.db
    .update(threads)
    .set({ status })
    .where(eq(threads.id, threadId))
    .run();
}

function addInteraction(
  harness: TestAppHarness,
  threadId: string,
  status: "pending" | "resolving",
) {
  harness.db
    .insert(pendingInteractions)
    .values({
      id: `${threadId}-interaction`,
      threadId,
      status,
      payload: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
}

function threadEvents(harness: TestAppHarness, threadId: string) {
  return harness.db
    .select()
    .from(events)
    .where(eq(events.threadId, threadId))
    .orderBy(events.sequence)
    .all();
}

function sequences(harness: TestAppHarness, threadId: string) {
  return threadEvents(harness, threadId).map((event) => event.sequence);
}

function runPruning(
  harness: TestAppHarness,
  limits: ThreadPruningSweepLimits,
  now: number,
): Promise<void> {
  return threadPruningSweep(harness.deps, limits).run(harness.deps, now);
}

const UNTIMED_SWEEP_LIMITS: ThreadPruningSweepLimits = {
  elapsedBudgetMs: Number.POSITIVE_INFINITY,
  maxAdvances: THREAD_PRUNING_SWEEP_LIMITS.maxAdvances,
};

describe("thread pruning sweep", () => {
  it("prunes settled threads while other threads are busy and leaves busy threads' events untouched", async () => {
    await withTestHarness(async (harness) => {
      const busy = {
        active: seed(harness, 600),
        starting: seed(harness, 600),
        pending: seed(harness, 600),
        resolving: seed(harness, 600),
      };
      const settled = [seed(harness, 600), seed(harness, 600)];
      setThreadStatus(harness, busy.active.id, "active");
      setThreadStatus(harness, busy.starting.id, "starting");
      addInteraction(harness, busy.pending.id, "pending");
      addInteraction(harness, busy.resolving.id, "resolving");
      const busyIds = Object.values(busy).map((thread) => thread.id);
      const before = busyIds.map((id) => threadEvents(harness, id));

      await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now());

      for (const thread of settled)
        expect(sequences(harness, thread.id)).toEqual([600]);
      expect(busyIds.map((id) => threadEvents(harness, id))).toEqual(before);

      setThreadStatus(harness, busy.active.id, "idle");
      setThreadStatus(harness, busy.starting.id, "idle");
      harness.db.update(pendingInteractions).set({ status: "resolved" }).run();
      await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now());
      for (const id of busyIds) expect(sequences(harness, id)).toEqual([600]);
    });
  });

  it("skips a thread whose pruning fails, keeps pruning the others, and retries it on a later cycle", async () => {
    await withTestHarness(async (harness) => {
      const [broken, healthy] = [seed(harness, 600), seed(harness, 600)].sort(
        (a, b) => a.id.localeCompare(b.id),
      );
      harness.db.run(
        sql.raw(
          `CREATE TEMP TRIGGER fail_prune BEFORE DELETE ON events WHEN old.thread_id = '${broken.id}' BEGIN SELECT RAISE(ABORT, 'prune failed'); END`,
        ),
      );

      await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now());
      expect(sequences(harness, healthy.id)).toEqual([600]);
      expect(sequences(harness, broken.id)).toHaveLength(600);
      expect(
        listSweepItemFailures(harness.db, "thread-event-pruning"),
      ).toMatchObject([
        {
          attempts: 1,
          itemKey: `turn-diffs:${broken.id}`,
          lastError: expect.stringContaining("prune failed"),
        },
      ]);

      harness.db.run(sql`DROP TRIGGER fail_prune`);
      await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now());
      expect(sequences(harness, broken.id)).toHaveLength(600);
      for (let i = 0; i < 3; i++)
        await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now() + 60_000);
      expect(sequences(harness, broken.id)).toEqual([600]);
      expect(listSweepItemFailures(harness.db, "thread-event-pruning")).toEqual(
        [],
      );
    });
  });

  it("leaves a thread that becomes busy mid-visit and keeps advancing other threads", async () => {
    await withTestHarness(async (harness) => {
      const [thread, other] = [seed(harness, 1200), seed(harness, 1200)].sort(
        (a, b) => a.id.localeCompare(b.id),
      );
      if (!thread || !other) throw new Error("Missing pruning fixtures");
      const generation = getThreadEventRewriteGeneration(thread.id);
      const notify = vi
        .spyOn(harness.deps.hub, "notifyThread")
        .mockImplementation(() => {});
      const debug = vi
        .spyOn(harness.deps.logger, "debug")
        .mockImplementation((fields, message) => {
          if (
            message === "Thread pruning policy advanced" &&
            removedEvents(fields) &&
            getThreadEventRewriteGeneration(thread.id) === generation + 1
          ) {
            expect(sequences(harness, thread.id)).toHaveLength(700);
            setThreadStatus(harness, thread.id, "active");
          }
        });
      await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now());
      debug.mockRestore();
      expect(sequences(harness, thread.id)).toHaveLength(700);
      expect(sequences(harness, other.id)).toEqual([1200]);
      expect(notify.mock.calls).toEqual([
        [thread.id, ["history-compacted"]],
        [other.id, ["history-compacted"]],
      ]);
      notify.mockRestore();

      setThreadStatus(harness, thread.id, "idle");
      await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now());
      expect(sequences(harness, thread.id)).toEqual([1200]);
    });
  });

  it("keeps notifications for earlier commits when the next transaction fails, then resumes", async () => {
    await withTestHarness(async (harness) => {
      const thread = seed(harness, 1200);
      const notify = vi
        .spyOn(harness.deps.hub, "notifyThread")
        .mockImplementation(() => {});
      const debug = vi
        .spyOn(harness.deps.logger, "debug")
        .mockImplementation((fields, message) => {
          if (
            message === "Thread pruning policy advanced" &&
            removedEvents(fields)
          )
            harness.db.run(
              sql`CREATE TRIGGER fail_next_prune BEFORE UPDATE ON thread_pruning_cursors BEGIN SELECT RAISE(ABORT, 'next batch failed'); END`,
            );
        });
      await expect(
        runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now()),
      ).rejects.toThrow("next batch failed");
      debug.mockRestore();
      expect(notify).toHaveBeenCalledExactlyOnceWith(thread.id, [
        "history-compacted",
      ]);
      expect(harness.db.select().from(events).all()).toHaveLength(700);
      harness.db.run(sql`DROP TRIGGER fail_next_prune`);
      notify.mockRestore();
      for (let i = 0; i < 3; i++)
        await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now() + 60_000);
      expect(
        harness.db
          .select()
          .from(events)
          .all()
          .map((row) => row.sequence),
      ).toEqual([1200]);
    });
  });

  it("notifies one history compaction per thread and brings every earlier viewer to the compacted timeline", async () => {
    await withTestHarness(async (harness) => {
      const thread = seed(harness, 2400);
      harness.db
        .insert(events)
        .values({
          id: `${thread.id}-message`,
          threadId: thread.id,
          sequence: 2401,
          scopeKind: "turn",
          turnId: "turn",
          type: "item/completed",
          data: JSON.stringify({
            item: { type: "agentMessage", id: "assistant-1", text: "Done." },
          }),
          createdAt: 1,
        })
        .run();
      const before = await getTimeline(harness, thread.id);
      expect(before.maxSeq).toBe(2401);
      const notify = vi.spyOn(harness.deps.hub, "notifyThread");
      const debug = vi.spyOn(harness.deps.logger, "debug");

      await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now());

      expect(
        debug.mock.calls.filter(
          ([fields, message]) =>
            message === "Thread pruning policy advanced" &&
            removedEvents(fields),
        ).length,
      ).toBeGreaterThan(1);
      expect(notify).toHaveBeenCalledExactlyOnceWith(thread.id, [
        "history-compacted",
      ]);
      expect(harness.db.select().from(events).all().length).toBeLessThan(2401);
      const cold = await getTimeline(harness, thread.id);
      const firstViewer = await getTimeline(harness, thread.id, before);
      const secondViewer = await getTimeline(harness, thread.id, before);
      for (const after of [firstViewer, secondViewer]) {
        expect(after.maxSeq).toBe(before.maxSeq);
        expect(after).toEqual(cold);
      }
      harness.db
        .insert(events)
        .values({
          id: `${thread.id}-follow-up`,
          threadId: thread.id,
          sequence: 2402,
          scopeKind: "turn",
          turnId: "turn",
          type: "item/completed",
          data: JSON.stringify({
            item: { type: "agentMessage", id: "assistant-2", text: "More." },
          }),
          createdAt: 2,
        })
        .run();
      const caughtUp = await getTimeline(harness, thread.id, before);
      expect(caughtUp.maxSeq).toBe(2402);
      expect(caughtUp).toEqual(await getTimeline(harness, thread.id));
      notify.mockRestore();
      debug.mockRestore();
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
        await runPruning(harness, THREAD_PRUNING_SWEEP_LIMITS, Date.now());
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
      let clock = 0;
      let slowed = false;
      const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
      harness.db.$client.function("slow_first_prune", () => {
        if (!slowed) clock += 75;
        slowed = true;
        return 0;
      });
      harness.db.run(
        sql`CREATE TEMP TRIGGER slow_prune BEFORE DELETE ON events BEGIN SELECT slow_first_prune(); END`,
      );
      const warn = vi.spyOn(harness.deps.logger, "warn");
      const debug = vi.spyOn(harness.deps.logger, "debug");
      try {
        await runPruning(harness, THREAD_PRUNING_SWEEP_LIMITS, Date.now());
        expect(warn).toHaveBeenCalledWith(
          expect.objectContaining({ advanceElapsedMs: 75 }),
          "Slow thread pruning advance",
        );
        const advanced = debug.mock.calls.filter(
          (call) => call[1] === "Thread pruning policy advanced",
        );
        expect(advanced.at(-1)?.[0]).toMatchObject({ advanceElapsedMs: 75 });
      } finally {
        now.mockRestore();
        warn.mockRestore();
        debug.mockRestore();
      }
    });
  });

  it("rotates durable policy progress and honors the advance budget", async () => {
    await withTestHarness(async (harness) => {
      seed(harness, 1);
      for (let i = 0; i < 100; i++) seed(harness, 1);
      const debug = vi.spyOn(harness.deps.logger, "debug");
      await runPruning(harness, UNTIMED_SWEEP_LIMITS, Date.now());
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
