import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createConnection } from "../../src/connection.js";
import type { DbTransaction } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import { threads } from "../../src/schema.js";
import {
  applyThreadLifecycleEvent,
  applyThreadLifecycleEventInTransaction,
  createThread,
  getThread,
  markThreadDeleted,
  requireThreadLifecycleEventApplied,
  ThreadLifecycleEventNotAppliedError,
} from "../../src/data/threads.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { withWriteAfterFirstRead } from "../helpers/interleave.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, host, project };
}

function spyNotifier(): DbNotifier {
  return {
    notifyThread: vi.fn(),
    notifyEnvironment: vi.fn(),
    notifyHost: vi.fn(),
    notifyProject: vi.fn(),
    notifySystem: vi.fn(),
  };
}

describe("applyThreadLifecycleEvent", () => {
  it("applies a legal event, persists the row, and notifies", () => {
    const { db, project } = setup();
    const spy = spyNotifier();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });

    const outcome = applyThreadLifecycleEvent(db, spy, {
      event: { type: "run.started" },
      threadId: thread.id,
    });

    expect(outcome.applied).toBe(true);
    if (outcome.applied) {
      expect(outcome.thread.status).toBe("active");
    }
    expect(getThread(db, thread.id)?.status).toBe("active");
    expect(spy.notifyThread).toHaveBeenCalledExactlyOnceWith(
      thread.id,
      ["status-changed"],
      { projectId: project.id },
    );
  });

  it("applies events inside an existing transaction", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });

    const outcome = db.transaction((tx) =>
      applyThreadLifecycleEventInTransaction(tx, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      }),
    );

    expect(outcome.applied).toBe(true);
    expect(getThread(db, thread.id)?.status).toBe("idle");
  });

  it("no-ops as illegal-transition and leaves the row untouched", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();
      const spy = spyNotifier();
      const thread = createThread(db, noopNotifier, {
        projectId: project.id,
        providerId: "codex",
        status: "idle",
      });

      vi.setSystemTime(2_000);
      // idle has no run.succeeded cell.
      const outcome = applyThreadLifecycleEvent(db, spy, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      });

      expect(outcome).toEqual({
        applied: false,
        detail: "no transition for run.succeeded from status idle",
        reason: "illegal-transition",
      });
      expect(getThread(db, thread.id)).toEqual(thread);
      expect(spy.notifyThread).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("no-ops as superseded when the thread is deleted", () => {
    const { db, project } = setup();
    const spy = spyNotifier();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });
    markThreadDeleted(db, noopNotifier, { threadId: thread.id });
    const beforeRow = getThread(db, thread.id);

    const outcome = applyThreadLifecycleEvent(db, spy, {
      event: { type: "run.started" },
      threadId: thread.id,
    });

    expect(outcome).toEqual({
      applied: false,
      detail: "deletedAt set",
      reason: "superseded",
    });
    expect(getThread(db, thread.id)).toEqual(beforeRow);
    expect(spy.notifyThread).not.toHaveBeenCalled();
  });

  it("refuses to reactivate a stopping thread and settles it to idle", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });

    // Enter the stopping phase via the stop.requested event.
    const stopping = requireThreadLifecycleEventApplied(
      applyThreadLifecycleEvent(db, noopNotifier, {
        event: { type: "stop.requested" },
        threadId: thread.id,
      }),
    );
    expect(stopping.status).toBe("stopping");
    const stoppingRow = getThread(db, thread.id);

    // A stopping thread structurally accepts no "begin new work" event. This
    // is the replacement for the old notStopRequested supersession guard.
    const outcome = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "run.started" },
      threadId: thread.id,
    });
    expect(outcome).toEqual({
      applied: false,
      detail: "no transition for run.started from status stopping",
      reason: "illegal-transition",
    });
    expect(getThread(db, thread.id)).toEqual(stoppingRow);

    // The stop landing settles the thread to idle.
    const settled = requireThreadLifecycleEventApplied(
      applyThreadLifecycleEvent(db, noopNotifier, {
        event: { type: "stop.settled" },
        threadId: thread.id,
      }),
    );
    expect(settled.status).toBe("idle");
  });

  it("no-ops as not-found for a missing thread", () => {
    const { db } = setup();
    const outcome = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "run.started" },
      threadId: "thr_nonexistent",
    });
    expect(outcome).toEqual({
      applied: false,
      detail: "thread not found: thr_nonexistent",
      reason: "not-found",
    });
  });

  it("no-ops the second of two sequential events once the first applied", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });

    const first = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "run.started" },
      threadId: thread.id,
    });
    const second = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "run.started" },
      threadId: thread.id,
    });

    expect(first.applied).toBe(true);
    expect(second).toEqual({
      applied: false,
      detail: "no transition for run.started from status active",
      reason: "illegal-transition",
    });
    expect(getThread(db, thread.id)?.status).toBe("active");
  });

  it("no-ops as cas-conflict when the status changes between load and update", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });

    const outcome = db.transaction((tx: DbTransaction) => {
      const interleaved = withWriteAfterFirstRead(tx, () => {
        tx.update(threads)
          .set({ status: "idle" })
          .where(eq(threads.id, thread.id))
          .run();
      });
      return applyThreadLifecycleEventInTransaction(interleaved, {
        event: { type: "run.started" },
        threadId: thread.id,
      });
    });

    expect(outcome).toEqual({
      applied: false,
      detail: "status changed from starting while applying run.started",
      reason: "cas-conflict",
    });
    // The interleaved writer's value survives; the event's target does not.
    expect(getThread(db, thread.id)?.status).toBe("idle");
  });

  it("sets latestAttentionAt only on attention-worthy transitions", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, project } = setup();

      const cases = [
        // active → idle on a root thread requires attention.
        {
          attention: true,
          event: { type: "run.succeeded" },
          parent: false,
          status: "active",
          target: "idle",
        },
        // active → idle on a child thread does not.
        {
          attention: false,
          event: { type: "run.succeeded" },
          parent: true,
          status: "active",
          target: "idle",
        },
        // starting → active never requires attention.
        {
          attention: false,
          event: { type: "run.started" },
          parent: false,
          status: "starting",
          target: "active",
        },
        // starting → error requires attention.
        {
          attention: true,
          event: { type: "run.failed" },
          parent: false,
          status: "starting",
          target: "error",
        },
      ] as const;

      let now = 1_000;
      for (const testCase of cases) {
        const parentThreadId = testCase.parent
          ? createThread(db, noopNotifier, {
              projectId: project.id,
              providerId: "codex",
            }).id
          : null;
        const thread = createThread(db, noopNotifier, {
          parentThreadId,
          projectId: project.id,
          providerId: "codex",
          status: testCase.status,
        });

        now += 1_000;
        vi.setSystemTime(now);
        const outcome = applyThreadLifecycleEvent(db, noopNotifier, {
          event: testCase.event,
          threadId: thread.id,
        });

        expect(outcome.applied).toBe(true);
        if (!outcome.applied) {
          continue;
        }
        expect(outcome.thread.status).toBe(testCase.target);
        expect(outcome.thread.updatedAt).toBe(now);
        expect(outcome.thread.latestAttentionAt).toBe(
          testCase.attention ? now : thread.latestAttentionAt,
        );
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("requireThreadLifecycleEventApplied", () => {
  it("returns the updated thread when applied", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });

    const updated = requireThreadLifecycleEventApplied(
      applyThreadLifecycleEvent(db, noopNotifier, {
        event: { type: "run.started" },
        threadId: thread.id,
      }),
    );
    expect(updated.status).toBe("active");
  });

  it("throws a typed error carrying reason and detail on a no-op", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });

    const outcome = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "run.succeeded" },
      threadId: thread.id,
    });
    let caught: ThreadLifecycleEventNotAppliedError | null = null;
    try {
      requireThreadLifecycleEventApplied(outcome);
    } catch (error) {
      if (error instanceof ThreadLifecycleEventNotAppliedError) {
        caught = error;
      }
    }
    expect(caught?.reason).toBe("illegal-transition");
    expect(caught?.detail).toBe(
      "no transition for run.succeeded from status idle",
    );
  });
});
