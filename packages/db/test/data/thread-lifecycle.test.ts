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
  markThreadStopRequested,
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
      status: "created",
    });

    const outcome = applyThreadLifecycleEvent(db, spy, {
      event: { type: "turn.started" },
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
        event: { type: "turn.completed" },
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
      // idle has no turn.completed cell.
      const outcome = applyThreadLifecycleEvent(db, spy, {
        event: { type: "turn.completed" },
        threadId: thread.id,
      });

      expect(outcome).toEqual({
        applied: false,
        detail: "no transition for turn.completed from status idle",
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
      status: "provisioning",
    });
    markThreadDeleted(db, noopNotifier, { threadId: thread.id });
    const beforeRow = getThread(db, thread.id);

    const outcome = applyThreadLifecycleEvent(db, spy, {
      event: { type: "start.succeeded" },
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

  it("no-ops as superseded when a stop is requested", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });
    markThreadStopRequested(db, noopNotifier, { threadId: thread.id });
    const beforeRow = getThread(db, thread.id);

    const outcome = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "turn.started" },
      threadId: thread.id,
    });

    expect(outcome).toEqual({
      applied: false,
      detail: "stopRequestedAt set",
      reason: "superseded",
    });
    expect(getThread(db, thread.id)).toEqual(beforeRow);
  });

  it("no-ops as not-found for a missing thread", () => {
    const { db } = setup();
    const outcome = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "turn.started" },
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
      status: "created",
    });

    const first = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "turn.started" },
      threadId: thread.id,
    });
    const second = applyThreadLifecycleEvent(db, noopNotifier, {
      event: { type: "turn.started" },
      threadId: thread.id,
    });

    expect(first.applied).toBe(true);
    expect(second).toEqual({
      applied: false,
      detail: "no transition for turn.started from status active",
      reason: "illegal-transition",
    });
    expect(getThread(db, thread.id)?.status).toBe("active");
  });

  it("no-ops as cas-conflict when the status changes between load and update", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "created",
    });

    const outcome = db.transaction((tx: DbTransaction) => {
      const interleaved = withWriteAfterFirstRead(tx, () => {
        tx.update(threads)
          .set({ status: "provisioning" })
          .where(eq(threads.id, thread.id))
          .run();
      });
      return applyThreadLifecycleEventInTransaction(interleaved, {
        event: { type: "turn.started" },
        threadId: thread.id,
      });
    });

    expect(outcome).toEqual({
      applied: false,
      detail: "status changed from created while applying turn.started",
      reason: "cas-conflict",
    });
    // The interleaved writer's value survives; the event's target does not.
    expect(getThread(db, thread.id)?.status).toBe("provisioning");
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
          event: { type: "turn.completed" },
          parent: false,
          status: "active",
          target: "idle",
        },
        // active → idle on a child thread does not.
        {
          attention: false,
          event: { type: "turn.completed" },
          parent: true,
          status: "active",
          target: "idle",
        },
        // created → active never requires attention.
        {
          attention: false,
          event: { type: "turn.started" },
          parent: false,
          status: "created",
          target: "active",
        },
        // provisioning → error requires attention.
        {
          attention: true,
          event: { type: "provision.failed" },
          parent: false,
          status: "provisioning",
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
        event: { type: "turn.dispatched" },
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
      event: { type: "turn.completed" },
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
      "no transition for turn.completed from status idle",
    );
  });
});
