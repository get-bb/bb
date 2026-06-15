import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createConnection } from "../../src/connection.js";
import type { DbTransaction } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import { environments, threads } from "../../src/schema.js";
import {
  applyEnvironmentLifecycleEvent,
  applyEnvironmentLifecycleEventInTransaction,
  createEnvironment,
  EnvironmentLifecycleEventNotAppliedError,
  getEnvironment,
  requireEnvironmentLifecycleEventApplied,
  type CreateEnvironmentInput,
} from "../../src/data/environments.js";
import {
  applyThreadLifecycleEvent,
  createThread,
  getThread,
  markThreadDeleted,
  requireThreadLifecycleEventApplied,
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
  const seedEnvironment = (
    input: Omit<CreateEnvironmentInput, "projectId" | "hostId" | "workspaceProvisionType">,
  ) =>
    createEnvironment(db, noopNotifier, {
      hostId: host.id,
      projectId: project.id,
      workspaceProvisionType: "managed-worktree",
      ...input,
    });
  return { db, host, project, seedEnvironment };
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

describe("applyEnvironmentLifecycleEvent", () => {
  it("applies a legal event, persists the row, and notifies", () => {
    const { db, seedEnvironment } = setup();
    const spy = spyNotifier();
    const environment = seedEnvironment({ status: "ready" });

    const outcome = applyEnvironmentLifecycleEvent(db, spy, {
      environmentId: environment.id,
      event: { type: "provision.requested" },
    });

    expect(outcome.applied).toBe(true);
    if (outcome.applied) {
      expect(outcome.environment.status).toBe("provisioning");
      expect(outcome.changes).toEqual(["status-changed"]);
    }
    expect(getEnvironment(db, environment.id)?.status).toBe("provisioning");
    expect(spy.notifyEnvironment).toHaveBeenCalledExactlyOnceWith(
      environment.id,
      ["status-changed"],
    );
  });

  it("applies events inside an existing transaction", () => {
    const { db, seedEnvironment } = setup();
    const environment = seedEnvironment({ status: "provisioning" });

    const outcome = db.transaction((tx) =>
      applyEnvironmentLifecycleEventInTransaction(tx, {
        environmentId: environment.id,
        event: { type: "provision.succeeded" },
      }),
    );

    expect(outcome.applied).toBe(true);
    expect(getEnvironment(db, environment.id)?.status).toBe("ready");
  });

  it("no-ops as illegal-transition and leaves the row untouched", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const { db, seedEnvironment } = setup();
      const spy = spyNotifier();
      const environment = seedEnvironment({ status: "ready" });

      vi.setSystemTime(2_000);
      // ready has no provision.succeeded cell.
      const outcome = applyEnvironmentLifecycleEvent(db, spy, {
        environmentId: environment.id,
        event: { type: "provision.succeeded" },
      });

      expect(outcome).toEqual({
        applied: false,
        detail: "no transition for provision.succeeded from status ready",
        reason: "illegal-transition",
      });
      expect(getEnvironment(db, environment.id)).toEqual(environment);
      expect(spy.notifyEnvironment).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("no-ops as superseded for a stale destroy attempt and leaves the row untouched", () => {
    const { db, seedEnvironment } = setup();
    const spy = spyNotifier();
    const environment = seedEnvironment({
      path: "/tmp/destroy-failed",
      status: "destroying",
    });
    db.update(environments)
      .set({ destroyAttemptId: "rpc_current" })
      .where(eq(environments.id, environment.id))
      .run();
    const beforeRow = getEnvironment(db, environment.id);

    const outcome = applyEnvironmentLifecycleEvent(db, spy, {
      environmentId: environment.id,
      event: { type: "destroy.failed", destroyAttemptId: "rpc_stale" },
    });

    expect(outcome).toEqual({
      applied: false,
      detail: "destroyAttemptId mismatch",
      reason: "superseded",
    });
    expect(getEnvironment(db, environment.id)).toEqual(beforeRow);
    expect(spy.notifyEnvironment).not.toHaveBeenCalled();
  });

  it("no-ops as not-found for a missing environment", () => {
    const { db } = setup();
    const outcome = applyEnvironmentLifecycleEvent(db, noopNotifier, {
      environmentId: "env_nonexistent",
      event: { type: "provision.requested" },
    });
    expect(outcome).toEqual({
      applied: false,
      detail: "environment not found: env_nonexistent",
      reason: "not-found",
    });
  });

  it("no-ops the second of two sequential destroy settlements once the first applied", () => {
    const { db, seedEnvironment } = setup();
    const environment = seedEnvironment({
      path: "/tmp/double-destroy",
      status: "destroying",
    });

    const first = applyEnvironmentLifecycleEvent(db, noopNotifier, {
      environmentId: environment.id,
      event: { type: "destroy.completed" },
    });
    const second = applyEnvironmentLifecycleEvent(db, noopNotifier, {
      environmentId: environment.id,
      event: { type: "destroy.completed" },
    });

    expect(first.applied).toBe(true);
    expect(second).toEqual({
      applied: false,
      detail: "no transition for destroy.completed from status destroyed",
      reason: "illegal-transition",
    });
    expect(getEnvironment(db, environment.id)?.status).toBe("destroyed");
  });

  it("no-ops as cas-conflict when the status changes between load and update", () => {
    const { db, seedEnvironment } = setup();
    const environment = seedEnvironment({ status: "ready" });

    const outcome = db.transaction((tx: DbTransaction) => {
      const interleaved = withWriteAfterFirstRead(tx, () => {
        tx.update(environments)
          .set({ status: "error" })
          .where(eq(environments.id, environment.id))
          .run();
      });
      return applyEnvironmentLifecycleEventInTransaction(interleaved, {
        environmentId: environment.id,
        event: { type: "provision.requested" },
      });
    });

    expect(outcome).toEqual({
      applied: false,
      detail: "state changed while applying provision.requested from status ready",
      reason: "cas-conflict",
    });
    // The interleaved writer's value survives; the event's target does not.
    expect(getEnvironment(db, environment.id)?.status).toBe("error");
  });

  it("stamps destroyAttemptId on destroy start and refuses while live threads exist", () => {
    const { db, project, seedEnvironment } = setup();
    const environment = seedEnvironment({
      managed: true,
      path: "/tmp/destroy-claim",
      status: "retiring",
    });
    const thread = createThread(db, noopNotifier, {
      environmentId: environment.id,
      projectId: project.id,
      providerId: "codex",
    });

    const blocked = applyEnvironmentLifecycleEvent(db, noopNotifier, {
      environmentId: environment.id,
      event: { type: "destroy.started", destroyAttemptId: "rpc_claim" },
    });
    expect(blocked).toEqual({
      applied: false,
      detail: "state changed while applying destroy.started from status retiring",
      reason: "cas-conflict",
    });
    expect(getEnvironment(db, environment.id)?.status).toBe("retiring");

    // A stopping thread blocks the claim even after deletion intent.
    requireThreadLifecycleEventApplied(
      applyThreadLifecycleEvent(db, noopNotifier, {
        event: { type: "stop.requested" },
        threadId: thread.id,
      }),
    );
    expect(getThread(db, thread.id)?.status).toBe("stopping");
    markThreadDeleted(db, noopNotifier, { threadId: thread.id });
    const blockedByStop = applyEnvironmentLifecycleEvent(db, noopNotifier, {
      environmentId: environment.id,
      event: { type: "destroy.started", destroyAttemptId: "rpc_claim" },
    });
    expect(blockedByStop.applied).toBe(false);

    db.delete(threads).where(eq(threads.id, thread.id)).run();
    const claimed = applyEnvironmentLifecycleEvent(db, noopNotifier, {
      environmentId: environment.id,
      event: { type: "destroy.started", destroyAttemptId: "rpc_claim" },
    });
    expect(claimed.applied).toBe(true);
    expect(getEnvironment(db, environment.id)).toMatchObject({
      destroyAttemptId: "rpc_claim",
      status: "destroying",
    });
  });

  it("clears the destroy attempt when reaching destroyed", () => {
    const { db, seedEnvironment } = setup();
    const spy = spyNotifier();
    const environment = seedEnvironment({
      managed: true,
      path: "/tmp/destroyed-clears",
      status: "destroying",
    });
    db.update(environments)
      .set({ destroyAttemptId: "rpc_claim" })
      .where(eq(environments.id, environment.id))
      .run();

    const outcome = applyEnvironmentLifecycleEvent(db, spy, {
      environmentId: environment.id,
      event: { type: "destroy.completed" },
    });

    expect(outcome.applied).toBe(true);
    expect(getEnvironment(db, environment.id)).toMatchObject({
      destroyAttemptId: null,
      status: "destroyed",
    });
    expect(spy.notifyEnvironment).toHaveBeenCalledExactlyOnceWith(
      environment.id,
      ["status-changed"],
    );
  });

  it("restores the settled state and clears the attempt on a matching destroy failure", () => {
    const { db, seedEnvironment } = setup();
    const environment = seedEnvironment({
      managed: true,
      path: "/tmp/destroy-restore",
      status: "destroying",
    });
    db.update(environments)
      .set({ destroyAttemptId: "rpc_claim" })
      .where(eq(environments.id, environment.id))
      .run();

    const outcome = applyEnvironmentLifecycleEvent(db, noopNotifier, {
      environmentId: environment.id,
      event: { type: "destroy.failed", destroyAttemptId: "rpc_claim" },
    });

    expect(outcome.applied).toBe(true);
    expect(getEnvironment(db, environment.id)).toMatchObject({
      destroyAttemptId: null,
      status: "retiring",
    });
  });
});

describe("requireEnvironmentLifecycleEventApplied", () => {
  it("returns the updated environment when applied", () => {
    const { db, seedEnvironment } = setup();
    const environment = seedEnvironment({ status: "error" });

    const updated = requireEnvironmentLifecycleEventApplied(
      applyEnvironmentLifecycleEvent(db, noopNotifier, {
        environmentId: environment.id,
        event: { type: "provision.requested" },
      }),
    );
    expect(updated.status).toBe("provisioning");
  });

  it("throws a typed error carrying reason and detail on a no-op", () => {
    const { db, seedEnvironment } = setup();
    const environment = seedEnvironment({ status: "ready" });

    const outcome = applyEnvironmentLifecycleEvent(db, noopNotifier, {
      environmentId: environment.id,
      event: { type: "provision.succeeded" },
    });
    let caught: EnvironmentLifecycleEventNotAppliedError | null = null;
    try {
      requireEnvironmentLifecycleEventApplied(outcome);
    } catch (error) {
      if (error instanceof EnvironmentLifecycleEventNotAppliedError) {
        caught = error;
      }
    }
    expect(caught?.reason).toBe("illegal-transition");
    expect(caught?.detail).toBe(
      "no transition for provision.succeeded from status ready",
    );
  });
});
