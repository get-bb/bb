import { describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createConnection } from "../../src/connection.js";
import type { DbConnection } from "../../src/connection.js";
import { createEventId } from "../../src/ids.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import type { DbNotifier } from "../../src/notifier.js";
import {
  COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
  COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
  COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS,
  pruneClosedSessions,
  pruneCompletedDurableCommandRows,
  pruneCompletedReadOnlyCommandRows,
  pruneCompletedCommandPayloads,
  listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement,
  sweepDestroyingEnvironments,
  sweepExpiredCommands,
  sweepExpiredLeases,
  sweepManagedEnvironments,
  truncateCompletedEventItemOutputs,
} from "../../src/data/sweeps.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import {
  createThread,
  archiveThread,
  markThreadDeleted,
  markThreadStopRequested,
} from "../../src/data/threads.js";
import {
  createEnvironment,
  recordEnvironmentCleanupRequest,
} from "../../src/data/environments.js";
import {
  markEnvironmentOperationRecordQueued,
  upsertEnvironmentOperationRecord,
} from "../../src/data/environment-operations.js";
import { openSession } from "../../src/data/sessions.js";
import {
  createPendingInteraction,
  setPendingInteractionResolving,
} from "../../src/data/pending-interactions.js";
import {
  markThreadOperationRecordQueued,
  upsertThreadOperationRecord,
} from "../../src/data/thread-operations.js";
import {
  cancelCommand,
  queueCommand,
  fetchCommands,
  reportCommandResult,
} from "../../src/data/commands.js";
import {
  environments,
  events,
  hostDaemonCommandAttempts,
  hostDaemonCommands,
  hostDaemonSessions,
  threads,
} from "../../src/schema.js";

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

const LEGACY_EXPIRED_RESULT_PAYLOAD = JSON.stringify({
  errorCode: "command_expired",
  errorMessage: "Command expired after retry",
});

interface MarkCommandLegacyExpiredArgs {
  commandId: string;
  completedAt?: number;
  db: DbConnection;
  resultPayload?: string;
}

function markCommandLegacyExpired(args: MarkCommandLegacyExpiredArgs): void {
  args.db
    .update(hostDaemonCommands)
    .set({
      state: "error",
      completedAt: args.completedAt ?? 100,
      resultPayload: args.resultPayload ?? LEGACY_EXPIRED_RESULT_PAYLOAD,
    })
    .where(eq(hostDaemonCommands.id, args.commandId))
    .run();
}

function expireActiveCommandAttempt(
  db: DbConnection,
  commandId: string,
  now = Date.now(),
): string {
  const expired = db
    .update(hostDaemonCommandAttempts)
    .set({ leaseExpiresAt: now - 1 })
    .where(
      and(
        eq(hostDaemonCommandAttempts.commandId, commandId),
        eq(hostDaemonCommandAttempts.status, "active"),
      ),
    )
    .returning({ id: hostDaemonCommandAttempts.id })
    .get();
  if (!expired) {
    throw new Error(`Command ${commandId} is missing an active attempt`);
  }
  return expired.id;
}

interface InsertCompletedItemEventArgs {
  createdAt: number;
  db: DbConnection;
  item: object;
  itemId: string;
  itemKind: "commandExecution" | "toolCall" | "webFetch" | "webSearch";
  sequence: number;
  threadId: string;
}

function insertCompletedItemEvent(args: InsertCompletedItemEventArgs): string {
  const id = createEventId();
  args.db
    .insert(events)
    .values({
      id,
      threadId: args.threadId,
      scopeKind: "turn",
      turnId: "turn_1",
      providerThreadId: "provider-thread-1",
      sequence: args.sequence,
      type: "item/completed",
      itemId: args.itemId,
      itemKind: args.itemKind,
      data: JSON.stringify({
        item: args.item,
        providerThreadId: "provider-thread-1",
        threadId: args.threadId,
        type: "item/completed",
      }),
      createdAt: args.createdAt,
    })
    .run();
  return id;
}

describe("sweepExpiredCommands", () => {
  it("re-queues commands after the first expired delivery attempt", () => {
    const { db, host } = setup();
    const now = Date.now();

    const cmd = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: JSON.stringify({ threadId: "thr_test" }),
    });

    // Fetch to mark as fetched
    fetchCommands(db, noopNotifier, { hostId: host.id, sessionId: null });
    expireActiveCommandAttempt(db, cmd.id, now);

    const result = sweepExpiredCommands(db, noopNotifier, now);
    expect(result.requeued).toBe(1);
    expect(result.expiredCommands).toEqual([]);

    const updated = db
      .select()
      .from(hostDaemonCommands)
      .where(eq(hostDaemonCommands.id, cmd.id))
      .get();
    expect(updated?.state).toBe("pending");
    expect(updated?.fetchedAt).toBeNull();
  });

  it("does not expire attempts for canceled fetched commands", () => {
    const { db, host } = setup();
    const now = Date.now();
    const command = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: JSON.stringify({ threadId: "thr_cancelled_sweep" }),
    });
    fetchCommands(db, noopNotifier, { hostId: host.id, sessionId: null });

    const cancelled = cancelCommand(db, {
      commandId: command.id,
      completedAt: now,
    });
    expect(cancelled).toMatchObject({
      id: command.id,
      state: "error",
    });
    expect(
      db
        .select({ status: hostDaemonCommandAttempts.status })
        .from(hostDaemonCommandAttempts)
        .where(eq(hostDaemonCommandAttempts.commandId, command.id))
        .all(),
    ).toEqual([{ status: "settled" }]);

    expect(sweepExpiredCommands(db, noopNotifier, now + 120_000)).toEqual({
      requeued: 0,
      expiredCommands: [],
    });
    expect(
      db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.id, command.id))
        .get(),
    ).toMatchObject({
      id: command.id,
      state: "error",
    });
  });

  it("returns retried expired command attempts without terminalizing them", () => {
    const { db, host, project } = setup();
    const now = Date.now();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });

    const cmd = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: JSON.stringify({ threadId: thread.id }),
    });

    fetchCommands(db, noopNotifier, { hostId: host.id, sessionId: null });
    expireActiveCommandAttempt(db, cmd.id, now);
    expect(sweepExpiredCommands(db, noopNotifier, now)).toMatchObject({
      requeued: 1,
      expiredCommands: [],
    });
    fetchCommands(db, noopNotifier, { hostId: host.id, sessionId: null });
    const retriedAttemptId = expireActiveCommandAttempt(db, cmd.id, now);

    const result = sweepExpiredCommands(db, noopNotifier, now);
    expect(result.requeued).toBe(0);
    expect(result.expiredCommands).toEqual([
      { commandId: cmd.id, attemptId: retriedAttemptId },
    ]);

    const updated = db
      .select()
      .from(hostDaemonCommands)
      .where(eq(hostDaemonCommands.id, cmd.id))
      .get();
    expect(updated).toMatchObject({
      state: "fetched",
      resultPayload: null,
    });
    expect(
      db
        .select({ status: hostDaemonCommandAttempts.status })
        .from(hostDaemonCommandAttempts)
        .where(eq(hostDaemonCommandAttempts.id, retriedAttemptId))
        .get(),
    ).toEqual({ status: "expired" });

    const updatedThread = db
      .select()
      .from(threads)
      .where(eq(threads.id, thread.id))
      .get();
    expect(updatedThread?.status).toBe("idle");
  });

  it("uses 20-minute TTL for environment.provision commands", () => {
    const { db, host } = setup();
    const now = Date.now();

    const cmd = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "environment.provision",
      payload: "{}",
    });

    const fetched = fetchCommands(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
    });
    expect(fetched[0]?.leaseExpiresAt).toBe(
      (fetched[0]?.deliveredAt ?? 0) + 20 * 60_000,
    );

    const result1 = sweepExpiredCommands(db, noopNotifier, now);
    expect(result1.requeued).toBe(0); // Not expired yet
    expect(result1.expiredCommands).toEqual([]);

    expireActiveCommandAttempt(db, cmd.id, now);

    const result2 = sweepExpiredCommands(db, noopNotifier, now);
    expect(result2.requeued).toBe(1); // Now expired and re-queued
  });

  it("returns retried deleted or stop-pending thread command ids without thread side effects", () => {
    const { db, host, project } = setup();
    const now = Date.now();
    const deletedThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });
    const stopPendingThread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });
    markThreadDeleted(db, noopNotifier, { threadId: deletedThread.id });
    markThreadStopRequested(db, noopNotifier, {
      threadId: stopPendingThread.id,
      requestedAt: 123,
    });

    const deletedCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: JSON.stringify({ threadId: deletedThread.id }),
    });
    const stopPendingCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: JSON.stringify({ threadId: stopPendingThread.id }),
    });

    fetchCommands(db, noopNotifier, { hostId: host.id, sessionId: null });
    expireActiveCommandAttempt(db, deletedCommand.id, now);
    expireActiveCommandAttempt(db, stopPendingCommand.id, now);
    expect(sweepExpiredCommands(db, noopNotifier, now)).toMatchObject({
      requeued: 2,
      expiredCommands: [],
    });
    fetchCommands(db, noopNotifier, { hostId: host.id, sessionId: null });
    const deletedAttemptId = expireActiveCommandAttempt(
      db,
      deletedCommand.id,
      now,
    );
    const stopPendingAttemptId = expireActiveCommandAttempt(
      db,
      stopPendingCommand.id,
      now,
    );

    const result = sweepExpiredCommands(db, noopNotifier, now);
    expect(result.expiredCommands).toHaveLength(2);
    expect(result.expiredCommands).toEqual(
      expect.arrayContaining([
        { commandId: deletedCommand.id, attemptId: deletedAttemptId },
        { commandId: stopPendingCommand.id, attemptId: stopPendingAttemptId },
      ]),
    );

    expect(
      db.select().from(threads).where(eq(threads.id, deletedThread.id)).get()
        ?.status,
    ).toBe("idle");
    expect(
      db
        .select()
        .from(threads)
        .where(eq(threads.id, stopPendingThread.id))
        .get()?.status,
    ).toBe("active");
  });
});

describe("listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement", () => {
  it("returns exact legacy expired rows with active owner records", () => {
    const { db, host, project } = setup();
    const environment = createEnvironment(db, noopNotifier, {
      hostId: host.id,
      projectId: project.id,
      status: "destroying",
      workspaceProvisionType: "managed-worktree",
    });
    const thread = createThread(db, noopNotifier, {
      environmentId: environment.id,
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });

    const environmentCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "environment.destroy",
      payload: JSON.stringify({
        type: "environment.destroy",
        environmentId: environment.id,
        workspaceContext: {
          workspacePath: environment.path ?? "/tmp/legacy-env",
          workspaceProvisionType: environment.workspaceProvisionType,
        },
      }),
    });
    upsertEnvironmentOperationRecord(db, {
      environmentId: environment.id,
      kind: "destroy",
      payload: "{}",
    });
    markEnvironmentOperationRecordQueued(db, {
      commandId: environmentCommand.id,
      environmentId: environment.id,
      kind: "destroy",
    });
    markCommandLegacyExpired({
      commandId: environmentCommand.id,
      completedAt: 10,
      db,
    });

    const threadCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "thread.stop",
      payload: JSON.stringify({
        type: "thread.stop",
        environmentId: environment.id,
        threadId: thread.id,
      }),
    });
    upsertThreadOperationRecord(db, {
      kind: "stop",
      payload: "{}",
      threadId: thread.id,
    });
    markThreadOperationRecordQueued(db, {
      commandId: threadCommand.id,
      kind: "stop",
      threadId: thread.id,
    });
    markCommandLegacyExpired({
      commandId: threadCommand.id,
      completedAt: 20,
      db,
    });

    const interaction = createPendingInteraction(db, {
      payload: JSON.stringify({ kind: "approval" }),
      providerId: "codex",
      providerRequestId: "request-legacy",
      providerThreadId: "provider-legacy",
      sessionId: "session-legacy",
      threadId: thread.id,
      turnId: "turn_legacy",
    });
    const interactionCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "interactive.resolve",
      payload: JSON.stringify({
        type: "interactive.resolve",
        environmentId: environment.id,
        interactionId: interaction.id,
        providerId: "codex",
        providerRequestId: "request-legacy",
        providerThreadId: "provider-legacy",
        resolution: { decision: "deny" },
        threadId: thread.id,
      }),
    });
    setPendingInteractionResolving(db, {
      commandId: interactionCommand.id,
      id: interaction.id,
      resolution: JSON.stringify({ decision: "deny" }),
    });
    markCommandLegacyExpired({
      commandId: interactionCommand.id,
      completedAt: 30,
      db,
    });

    const wrongPayloadCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "environment.destroy",
      payload: "{}",
    });
    const wrongPayloadEnvironment = createEnvironment(db, noopNotifier, {
      hostId: host.id,
      projectId: project.id,
      status: "destroying",
      workspaceProvisionType: "managed-worktree",
    });
    upsertEnvironmentOperationRecord(db, {
      environmentId: wrongPayloadEnvironment.id,
      kind: "destroy",
      payload: "{}",
    });
    markEnvironmentOperationRecordQueued(db, {
      commandId: wrongPayloadCommand.id,
      environmentId: wrongPayloadEnvironment.id,
      kind: "destroy",
    });
    markCommandLegacyExpired({
      commandId: wrongPayloadCommand.id,
      db,
      resultPayload: JSON.stringify({
        errorMessage: "Command expired after retry",
        errorCode: "command_expired",
      }),
    });

    const ownerlessCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "thread.stop",
      payload: "{}",
    });
    markCommandLegacyExpired({ commandId: ownerlessCommand.id, db });

    expect(
      listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement(db, {
        limit: 10,
      }),
    ).toEqual([
      environmentCommand.id,
      threadCommand.id,
      interactionCommand.id,
    ]);
    expect(
      listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement(db, {
        limit: 2,
      }),
    ).toEqual([environmentCommand.id, threadCommand.id]);
    expect(
      listLegacyTerminalizedExpiredLifecycleCommandsNeedingSettlement(db, {
        limit: 0,
      }),
    ).toEqual([]);
  });
});

describe("pruneCompletedCommandPayloads", () => {
  it("clears terminal command blobs before the retention cutoff", () => {
    const { db, host } = setup();
    const now = Date.now();
    const staleCompletedAt = now - 10_000;
    const freshCompletedAt = now;
    const completedBefore = now - 5_000;

    const staleSuccess = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: JSON.stringify({ stale: "success" }),
    });
    const staleError = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.squash_merge",
      payload: JSON.stringify({ stale: "error" }),
    });
    const freshSuccess = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "thread.rename",
      payload: JSON.stringify({ fresh: true }),
    });
    const fetchedCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "thread.stop",
      payload: JSON.stringify({ fetched: true }),
    });

    reportCommandResult(db, noopNotifier, {
      commandId: staleSuccess.id,
      state: "success",
      completedAt: staleCompletedAt,
      resultPayload: JSON.stringify({ ok: true }),
    });
    reportCommandResult(db, noopNotifier, {
      commandId: staleError.id,
      state: "error",
      completedAt: staleCompletedAt,
      resultPayload: JSON.stringify({
        errorCode: "failed",
        errorMessage: "failed",
      }),
    });
    reportCommandResult(db, noopNotifier, {
      commandId: freshSuccess.id,
      state: "success",
      completedAt: freshCompletedAt,
      resultPayload: JSON.stringify({ ok: true }),
    });
    fetchCommands(db, noopNotifier, { hostId: host.id, sessionId: null });
    const pendingCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "thread.archive",
      payload: JSON.stringify({ pending: true }),
    });

    const result = pruneCompletedCommandPayloads(db, { completedBefore });

    expect(result).toEqual({ pruned: 2 });
    expect(
      db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.id, staleSuccess.id))
        .get(),
    ).toMatchObject({
      completedAt: staleCompletedAt,
      cursor: staleSuccess.cursor,
      payload: "{}",
      resultPayload: null,
      state: "success",
    });
    expect(
      db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.id, staleError.id))
        .get(),
    ).toMatchObject({
      completedAt: staleCompletedAt,
      cursor: staleError.cursor,
      payload: "{}",
      resultPayload: null,
      state: "error",
    });
    expect(
      db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.id, freshSuccess.id))
        .get(),
    ).toMatchObject({
      payload: JSON.stringify({ fresh: true }),
      resultPayload: JSON.stringify({ ok: true }),
      state: "success",
    });
    expect(
      db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.id, fetchedCommand.id))
        .get(),
    ).toMatchObject({
      payload: JSON.stringify({ fetched: true }),
      resultPayload: null,
      state: "fetched",
    });
    expect(
      db
        .select()
        .from(hostDaemonCommands)
        .where(eq(hostDaemonCommands.id, pendingCommand.id))
        .get(),
    ).toMatchObject({
      payload: JSON.stringify({ pending: true }),
      resultPayload: null,
      state: "pending",
    });
  });

  it("does not count already-pruned terminal commands on later sweeps", () => {
    const { db, host } = setup();
    const completedAt = Date.now() - 10_000;
    const completedBefore = Date.now();
    const command = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: JSON.stringify({ prunable: true }),
    });

    reportCommandResult(db, noopNotifier, {
      commandId: command.id,
      state: "success",
      completedAt,
      resultPayload: JSON.stringify({ ok: true }),
    });

    expect(pruneCompletedCommandPayloads(db, { completedBefore })).toEqual({
      pruned: 1,
    });
    expect(pruneCompletedCommandPayloads(db, { completedBefore })).toEqual({
      pruned: 0,
    });
  });
});

describe("pruneCompletedCommandRows", () => {
  it("deletes only old terminal command rows", () => {
    const { db, host } = setup();
    const now = Date.now();
    const staleCompletedAt = now - 10_000;
    const freshCompletedAt = now;
    const completedBefore = now - 5_000;

    const staleSuccess = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "environment.cleanup_preflight",
      payload: "{}",
    });
    const staleError = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "environment.cleanup_preflight",
      payload: "{}",
    });
    const freshSuccess = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: "{}",
    });
    const fetchedCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "thread.stop",
      payload: "{}",
    });

    reportCommandResult(db, noopNotifier, {
      commandId: staleSuccess.id,
      state: "success",
      completedAt: staleCompletedAt,
      resultPayload: JSON.stringify({ ok: true }),
    });
    reportCommandResult(db, noopNotifier, {
      commandId: staleError.id,
      state: "error",
      completedAt: staleCompletedAt,
      resultPayload: JSON.stringify({ errorMessage: "failed" }),
    });
    reportCommandResult(db, noopNotifier, {
      commandId: freshSuccess.id,
      state: "success",
      completedAt: freshCompletedAt,
      resultPayload: JSON.stringify({ ok: true }),
    });
    fetchCommands(db, noopNotifier, { hostId: host.id, sessionId: null });

    expect(
      pruneCompletedReadOnlyCommandRows(db, {
        completedBefore,
        limit: 100,
      }),
    ).toEqual({ deleted: 2 });
    expect(
      pruneCompletedDurableCommandRows(db, {
        completedBefore,
        limit: 100,
      }),
    ).toEqual({ deleted: 0 });

    expect(
      db
        .select()
        .from(hostDaemonCommands)
        .all()
        .map((command) => command.id),
    ).toEqual([freshSuccess.id, fetchedCommand.id]);
  });

  it("prunes read-only rows without touching durable rows", () => {
    const { db, host } = setup();
    const now = Date.now();
    const completedAt = now - 10_000;
    const completedBefore = now - 5_000;

    const readOnly = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "environment.cleanup_preflight",
      payload: "{}",
    });
    const durable = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "workspace.commit",
      payload: "{}",
    });
    for (const command of [readOnly, durable]) {
      reportCommandResult(db, noopNotifier, {
        commandId: command.id,
        state: "success",
        completedAt,
        resultPayload: null,
      });
    }

    expect(
      pruneCompletedReadOnlyCommandRows(db, {
        completedBefore,
        limit: 100,
      }),
    ).toEqual({ deleted: 1 });
    expect(
      db
        .select()
        .from(hostDaemonCommands)
        .all()
        .map((command) => command.id),
    ).toEqual([durable.id]);
  });

  it("prunes historical rows for removed command types in the read-only cohort", () => {
    const { db, host } = setup();
    const now = Date.now();
    const completedAt = now - 10_000;
    const completedBefore = now - 5_000;

    // Rows of this type predate the removal of the manager storage
    // templates feature; the contract no longer knows the type, so queue
    // under a current type and rewrite the row to the historical value.
    const legacy = queueCommand(db, noopNotifier, {
      hostId: host.id,
      sessionId: null,
      type: "environment.cleanup_preflight",
      payload: "{}",
    });
    reportCommandResult(db, noopNotifier, {
      commandId: legacy.id,
      state: "success",
      completedAt,
      resultPayload: null,
    });
    db.update(hostDaemonCommands)
      .set({ type: "host.list_manager_templates" })
      .where(eq(hostDaemonCommands.id, legacy.id))
      .run();

    expect(
      pruneCompletedDurableCommandRows(db, {
        completedBefore,
        limit: 100,
      }),
    ).toEqual({ deleted: 0 });
    expect(
      pruneCompletedReadOnlyCommandRows(db, {
        completedBefore,
        limit: 100,
      }),
    ).toEqual({ deleted: 1 });
    expect(db.select().from(hostDaemonCommands).all()).toEqual([]);
  });

  it("honors the delete batch limit", () => {
    const { db, host } = setup();
    const now = Date.now();
    const completedAt = now - 10_000;
    const completedBefore = now - 5_000;

    for (const type of [
      "environment.cleanup_preflight",
      "environment.cleanup_preflight",
      "workspace.commit",
    ] as const) {
      const command = queueCommand(db, noopNotifier, {
        hostId: host.id,
        sessionId: null,
        type,
        payload: "{}",
      });
      reportCommandResult(db, noopNotifier, {
        commandId: command.id,
        state: "success",
        completedAt,
        resultPayload: null,
      });
    }

    expect(
      pruneCompletedReadOnlyCommandRows(db, {
        completedBefore,
        limit: 2,
      }),
    ).toEqual({ deleted: 2 });
    expect(db.select().from(hostDaemonCommands).all()).toHaveLength(1);
  });

  it("drains a read-only backlog larger than one batch across repeated sweeps", () => {
    const { db, host } = setup();
    const now = Date.now();
    const completedAt = now - 10_000;
    const completedBefore = now - 5_000;
    const backlog = 25;
    const batchLimit = 10;

    for (let index = 0; index < backlog; index += 1) {
      const command = queueCommand(db, noopNotifier, {
        hostId: host.id,
        sessionId: null,
        type: "environment.cleanup_preflight",
        payload: "{}",
      });
      reportCommandResult(db, noopNotifier, {
        commandId: command.id,
        state: "success",
        completedAt,
        resultPayload: null,
      });
    }

    let sweeps = 0;
    while (
      pruneCompletedReadOnlyCommandRows(db, {
        completedBefore,
        limit: batchLimit,
      }).deleted > 0
    ) {
      sweeps += 1;
      expect(sweeps).toBeLessThanOrEqual(backlog);
    }

    expect(db.select().from(hostDaemonCommands).all()).toHaveLength(0);
    expect(sweeps).toBe(Math.ceil(backlog / batchLimit));
  });
});

describe("truncateCompletedEventItemOutputs", () => {
  it("truncates old large completed item outputs with metadata", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });
    const now = Date.now();
    const staleCreatedAt = now - 10_000;
    const freshCreatedAt = now;
    const createdBefore = now - 5_000;
    const commandOutput =
      "command-head-" +
      "a".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "-command-tail";
    const toolResult =
      "tool-head-" +
      "b".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "-tool-tail";
    const webSearchResultText =
      "search-head-" +
      "c".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "-search-tail";
    const webFetchResultText =
      "fetch-head-" +
      "d".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "-fetch-tail";
    const smallOutput = "short output";

    const commandEventId = insertCompletedItemEvent({
      createdAt: staleCreatedAt,
      db,
      item: {
        type: "commandExecution",
        id: "cmd-item",
        command: "rg large",
        cwd: "/tmp/project",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: commandOutput,
      },
      itemId: "cmd-item",
      itemKind: "commandExecution",
      sequence: 1,
      threadId: thread.id,
    });
    const toolEventId = insertCompletedItemEvent({
      createdAt: staleCreatedAt,
      db,
      item: {
        type: "toolCall",
        id: "tool-item",
        tool: "Read",
        status: "completed",
        result: toolResult,
      },
      itemId: "tool-item",
      itemKind: "toolCall",
      sequence: 2,
      threadId: thread.id,
    });
    const freshEventId = insertCompletedItemEvent({
      createdAt: freshCreatedAt,
      db,
      item: {
        type: "commandExecution",
        id: "fresh-item",
        command: "rg fresh",
        cwd: "/tmp/project",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: commandOutput,
      },
      itemId: "fresh-item",
      itemKind: "commandExecution",
      sequence: 3,
      threadId: thread.id,
    });
    const webSearchEventId = insertCompletedItemEvent({
      createdAt: staleCreatedAt,
      db,
      item: {
        type: "webSearch",
        id: "web-search-item",
        queries: ["retention policy"],
        resultText: webSearchResultText,
      },
      itemId: "web-search-item",
      itemKind: "webSearch",
      sequence: 4,
      threadId: thread.id,
    });
    const webFetchEventId = insertCompletedItemEvent({
      createdAt: staleCreatedAt,
      db,
      item: {
        type: "webFetch",
        id: "web-fetch-item",
        url: "https://example.com/large",
        prompt: null,
        pattern: null,
        resultText: webFetchResultText,
      },
      itemId: "web-fetch-item",
      itemKind: "webFetch",
      sequence: 5,
      threadId: thread.id,
    });
    const smallEventId = insertCompletedItemEvent({
      createdAt: staleCreatedAt,
      db,
      item: {
        type: "commandExecution",
        id: "small-item",
        command: "pwd",
        cwd: "/tmp/project",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: smallOutput,
      },
      itemId: "small-item",
      itemKind: "commandExecution",
      sequence: 6,
      threadId: thread.id,
    });

    const result = truncateCompletedEventItemOutputs(db, {
      createdBefore,
      limit: 10,
      truncatedAt: now,
    });

    expect(result).toEqual({
      commandExecutionOutputs: 1,
      toolCallResults: 1,
      webFetchResultTexts: 1,
      webSearchResultTexts: 1,
    });

    const commandData = JSON.parse(
      db.select().from(events).where(eq(events.id, commandEventId)).get()
        ?.data ?? "{}",
    );
    expect(commandData.item.aggregatedOutput).not.toBe(commandOutput);
    expect(commandData.item.aggregatedOutput).toContain(
      "output truncated by retention policy",
    );
    expect(commandData.item.aggregatedOutput.startsWith(commandOutput.slice(0, COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS))).toBe(true);
    expect(commandData.item.aggregatedOutput.endsWith(commandOutput.slice(-COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS))).toBe(true);
    expect(commandData.item.truncation.aggregatedOutput).toEqual({
      originalLength: commandOutput.length,
      retainedHeadLength: COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
      retainedTailLength: COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
      truncatedAt: now,
    });

    const toolData = JSON.parse(
      db.select().from(events).where(eq(events.id, toolEventId)).get()?.data ??
        "{}",
    );
    expect(toolData.item.result).not.toBe(toolResult);
    expect(toolData.item.result).toContain(
      "output truncated by retention policy",
    );
    expect(toolData.item.result.startsWith(toolResult.slice(0, COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS))).toBe(true);
    expect(toolData.item.result.endsWith(toolResult.slice(-COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS))).toBe(true);
    expect(toolData.item.truncation.result).toEqual({
      originalLength: toolResult.length,
      retainedHeadLength: COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
      retainedTailLength: COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
      truncatedAt: now,
    });

    const webSearchData = JSON.parse(
      db
        .select()
        .from(events)
        .where(eq(events.id, webSearchEventId))
        .get()?.data ?? "{}",
    );
    expect(webSearchData.item.resultText).not.toBe(webSearchResultText);
    expect(webSearchData.item.resultText).toContain(
      "output truncated by retention policy",
    );
    expect(
      webSearchData.item.resultText.startsWith(
        webSearchResultText.slice(0, COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS),
      ),
    ).toBe(true);
    expect(
      webSearchData.item.resultText.endsWith(
        webSearchResultText.slice(-COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS),
      ),
    ).toBe(true);
    expect(webSearchData.item.truncation.resultText).toEqual({
      originalLength: webSearchResultText.length,
      retainedHeadLength: COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
      retainedTailLength: COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
      truncatedAt: now,
    });

    const webFetchData = JSON.parse(
      db.select().from(events).where(eq(events.id, webFetchEventId)).get()
        ?.data ?? "{}",
    );
    expect(webFetchData.item.resultText).not.toBe(webFetchResultText);
    expect(webFetchData.item.resultText).toContain(
      "output truncated by retention policy",
    );
    expect(
      webFetchData.item.resultText.startsWith(
        webFetchResultText.slice(0, COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS),
      ),
    ).toBe(true);
    expect(
      webFetchData.item.resultText.endsWith(
        webFetchResultText.slice(-COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS),
      ),
    ).toBe(true);
    expect(webFetchData.item.truncation.resultText).toEqual({
      originalLength: webFetchResultText.length,
      retainedHeadLength: COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
      retainedTailLength: COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
      truncatedAt: now,
    });

    const freshData = JSON.parse(
      db.select().from(events).where(eq(events.id, freshEventId)).get()?.data ??
        "{}",
    );
    expect(freshData.item.aggregatedOutput).toBe(commandOutput);
    const smallData = JSON.parse(
      db.select().from(events).where(eq(events.id, smallEventId)).get()?.data ??
        "{}",
    );
    expect(smallData.item.aggregatedOutput).toBe(smallOutput);

    expect(
      truncateCompletedEventItemOutputs(db, {
        createdBefore,
        limit: 10,
        truncatedAt: now,
      }),
    ).toEqual({
      commandExecutionOutputs: 0,
      toolCallResults: 0,
      webFetchResultTexts: 0,
      webSearchResultTexts: 0,
    });
  });

  it("advances durable cursors past old small outputs", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "idle",
    });
    const now = Date.now();
    const staleCreatedAt = now - 10_000;
    const createdBefore = now - 5_000;
    const largeOutput =
      "command-head-" +
      "a".repeat(COMPLETED_EVENT_OUTPUT_TRUNCATION_THRESHOLD_CHARS) +
      "-command-tail";

    insertCompletedItemEvent({
      createdAt: staleCreatedAt,
      db,
      item: {
        type: "commandExecution",
        id: "small-before-large",
        command: "pwd",
        cwd: "/tmp/project",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: "small output",
      },
      itemId: "small-before-large",
      itemKind: "commandExecution",
      sequence: 1,
      threadId: thread.id,
    });
    const largeEventId = insertCompletedItemEvent({
      createdAt: staleCreatedAt + 1,
      db,
      item: {
        type: "commandExecution",
        id: "large-after-small",
        command: "cat large",
        cwd: "/tmp/project",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: largeOutput,
      },
      itemId: "large-after-small",
      itemKind: "commandExecution",
      sequence: 2,
      threadId: thread.id,
    });

    expect(
      truncateCompletedEventItemOutputs(db, {
        createdBefore,
        limit: 1,
        truncatedAt: now,
      }).commandExecutionOutputs,
    ).toBe(0);
    expect(
      truncateCompletedEventItemOutputs(db, {
        createdBefore,
        limit: 1,
        truncatedAt: now,
      }).commandExecutionOutputs,
    ).toBe(1);

    const largeData = JSON.parse(
      db.select().from(events).where(eq(events.id, largeEventId)).get()?.data ??
        "{}",
    );
    expect(largeData.item.truncation.aggregatedOutput).toEqual({
      originalLength: largeOutput.length,
      retainedHeadLength: COMPLETED_EVENT_OUTPUT_RETAINED_HEAD_CHARS,
      retainedTailLength: COMPLETED_EVENT_OUTPUT_RETAINED_TAIL_CHARS,
      truncatedAt: now,
    });
  });
});

describe("pruneClosedSessions", () => {
  function openClosedSessionAt(args: {
    closedAt: number;
    db: DbConnection;
    hostId: string;
    instanceId: string;
  }): string {
    const session = openSession(args.db, noopNotifier, {
      hostId: args.hostId,
      instanceId: args.instanceId,
      hostName: "test-host",
      hostType: "persistent",
      dataDir: "/tmp/test-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });
    args.db
      .update(hostDaemonSessions)
      .set({
        status: "closed",
        closedAt: args.closedAt,
        closeReason: "replaced",
        updatedAt: args.closedAt,
      })
      .where(eq(hostDaemonSessions.id, session.id))
      .run();
    return session.id;
  }

  it("deletes closed sessions older than the threshold", () => {
    const { db, host } = setup();
    const now = Date.now();

    const stale = openClosedSessionAt({
      closedAt: now - 10_000,
      db,
      hostId: host.id,
      instanceId: "inst-stale",
    });
    const fresh = openClosedSessionAt({
      closedAt: now - 1_000,
      db,
      hostId: host.id,
      instanceId: "inst-fresh",
    });
    const active = openSession(db, noopNotifier, {
      hostId: host.id,
      instanceId: "inst-active",
      hostName: "test-host",
      hostType: "persistent",
      dataDir: "/tmp/test-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });

    expect(
      pruneClosedSessions(db, {
        closedBefore: now - 5_000,
        limit: 100,
      }),
    ).toEqual({ deleted: 1 });

    expect(
      db
        .select({ id: hostDaemonSessions.id })
        .from(hostDaemonSessions)
        .all()
        .map((row) => row.id)
        .sort(),
    ).toEqual([fresh, active.id].sort());
    expect(
      db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, stale))
        .get(),
    ).toBeUndefined();
  });

  it("never deletes the currently active session", () => {
    const { db, host } = setup();
    const now = Date.now();

    const active = openSession(db, noopNotifier, {
      hostId: host.id,
      instanceId: "inst-active",
      hostName: "test-host",
      hostType: "persistent",
      dataDir: "/tmp/test-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });

    expect(
      pruneClosedSessions(db, {
        closedBefore: now + 60_000,
        limit: 100,
      }),
    ).toEqual({ deleted: 0 });
    expect(
      db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.id, active.id))
        .get()?.status,
    ).toBe("active");
  });

  it("honors the delete batch limit", () => {
    const { db, host } = setup();
    const now = Date.now();
    const closedAt = now - 10_000;

    for (const instanceId of ["inst-a", "inst-b", "inst-c"]) {
      openClosedSessionAt({ closedAt, db, hostId: host.id, instanceId });
    }

    expect(
      pruneClosedSessions(db, {
        closedBefore: now - 5_000,
        limit: 2,
      }),
    ).toEqual({ deleted: 2 });
    expect(
      db
        .select()
        .from(hostDaemonSessions)
        .where(eq(hostDaemonSessions.status, "closed"))
        .all(),
    ).toHaveLength(1);
  });
});

describe("sweepExpiredLeases", () => {
  it("closes expired sessions without erroring active threads", () => {
    const { db, host, project } = setup();

    const env = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/env",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });

    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: env.id,
      providerId: "codex",
      status: "active",
    });

    const session = openSession(db, noopNotifier, {
      hostId: host.id,
      instanceId: "inst-1",
      hostName: "test-host",
      hostType: "persistent",
      dataDir: "/tmp/test-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });

    // Set lease to the past
    db.update(hostDaemonSessions)
      .set({ leaseExpiresAt: Date.now() - 1000 })
      .where(eq(hostDaemonSessions.id, session.id))
      .run();

    const spy: DbNotifier = {
      notifyThread: vi.fn(),
      notifyEnvironment: vi.fn(),
      notifyCommand: vi.fn(),
      notifyProject: vi.fn(),
      notifyHost: vi.fn(),
      notifySystem: vi.fn(),
    };

    const result = sweepExpiredLeases(db, spy);
    expect(result.sessionsClosed).toBe(1);
    expect(result.expiredHostIds).toEqual([host.id]);
    expect(result.expiredSessionIds).toEqual([session.id]);

    // Session should be closed
    const updatedSession = db
      .select()
      .from(hostDaemonSessions)
      .where(eq(hostDaemonSessions.id, session.id))
      .get();
    expect(updatedSession?.status).toBe("closed");
    expect(updatedSession?.closeReason).toBe("expired");

    const updatedThread = db
      .select()
      .from(threads)
      .where(eq(threads.id, thread.id))
      .get();
    expect(updatedThread?.status).toBe("active");

    expect(spy.notifyHost).toHaveBeenCalledWith(host.id, ["host-disconnected"]);
    expect(spy.notifyThread).not.toHaveBeenCalled();
  });

  it("does not error idle threads on lease expiry", () => {
    const { db, host, project } = setup();

    const env = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/env",
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });

    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: env.id,
      providerId: "codex",
      status: "idle",
    });

    const session = openSession(db, noopNotifier, {
      hostId: host.id,
      instanceId: "inst-1",
      hostName: "test-host",
      hostType: "persistent",
      dataDir: "/tmp/test-host-data",
      protocolVersion: 1,
      heartbeatIntervalMs: 10_000,
      leaseTimeoutMs: 30_000,
    });

    db.update(hostDaemonSessions)
      .set({ leaseExpiresAt: Date.now() - 1000 })
      .where(eq(hostDaemonSessions.id, session.id))
      .run();

    const result = sweepExpiredLeases(db, noopNotifier);
    expect(result.sessionsClosed).toBe(1);
    expect(result.expiredHostIds).toEqual([host.id]);
    expect(result.expiredSessionIds).toEqual([session.id]);

    const updatedThread = db
      .select()
      .from(threads)
      .where(eq(threads.id, thread.id))
      .get();
    expect(updatedThread?.status).toBe("idle");
  });
});

describe("sweepManagedEnvironments", () => {
  it("returns managed environments with cleanup requested and zero non-archived threads", () => {
    const { db, host, project } = setup();

    const env = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/env",
      managed: true,
      workspaceProvisionType: "managed-worktree",
      status: "ready",
    });

    recordEnvironmentCleanupRequest(db, noopNotifier, env.id, {
      requestedAt: 123,
    });

    const candidates1 = sweepManagedEnvironments(db);
    expect(candidates1).toHaveLength(1);
    expect(candidates1[0]!.id).toBe(env.id);
  });

  it("does not return environments with non-archived threads", () => {
    const { db, host, project } = setup();

    const env = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/env",
      managed: true,
      workspaceProvisionType: "managed-worktree",
      status: "ready",
    });

    recordEnvironmentCleanupRequest(db, noopNotifier, env.id, {
      requestedAt: 123,
    });

    createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: env.id,
      providerId: "codex",
      status: "idle",
    });

    const candidates = sweepManagedEnvironments(db);
    expect(candidates).toHaveLength(0);
  });

  it("returns environment after all threads are archived", () => {
    const { db, host, project } = setup();

    const env = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/env",
      managed: true,
      workspaceProvisionType: "managed-worktree",
      status: "ready",
    });

    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: env.id,
      providerId: "codex",
      status: "idle",
    });

    recordEnvironmentCleanupRequest(db, noopNotifier, env.id, {
      requestedAt: 123,
    });

    // Not a candidate while thread is active
    expect(sweepManagedEnvironments(db)).toHaveLength(0);

    // Archive the thread
    archiveThread(db, noopNotifier, thread.id);

    // Now it's a candidate
    const candidates = sweepManagedEnvironments(db);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe(env.id);
  });

  it("treats soft-deleted threads as non-live when selecting cleanup candidates", () => {
    const { db, host, project } = setup();

    const env = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/env",
      managed: true,
      workspaceProvisionType: "managed-worktree",
      status: "ready",
    });

    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      environmentId: env.id,
      providerId: "codex",
      status: "idle",
    });

    recordEnvironmentCleanupRequest(db, noopNotifier, env.id, {
      requestedAt: 123,
    });

    markThreadDeleted(db, noopNotifier, { threadId: thread.id });

    const candidates = sweepManagedEnvironments(db);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe(env.id);
  });

  it("does not return unmanaged environments", () => {
    const { db, host, project } = setup();

    const env = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/env",
      managed: false,
      workspaceProvisionType: "unmanaged",
      status: "ready",
    });

    recordEnvironmentCleanupRequest(db, noopNotifier, env.id, {
      requestedAt: 123,
    });

    const candidates = sweepManagedEnvironments(db);
    expect(candidates).toHaveLength(0);
  });

  it("returns destroying environments with cleanup requested so sweeps can resume destroy queueing", () => {
    const { db, host, project } = setup();

    const env = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/env",
      managed: true,
      cleanupRequestedAt: 123,
      workspaceProvisionType: "managed-worktree",
      status: "destroying",
    });

    const candidates = sweepManagedEnvironments(db);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe(env.id);
  });
});

describe("sweepDestroyingEnvironments", () => {
  it("hard-deletes stale destroying environments after the retention window", () => {
    const { db, host, project } = setup();
    const now = Date.now();

    const staleEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/stale-destroying",
      managed: true,
      workspaceProvisionType: "managed-worktree",
      status: "destroying",
    });
    const freshEnvironment = createEnvironment(db, noopNotifier, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/fresh-destroying",
      managed: true,
      workspaceProvisionType: "managed-worktree",
      status: "destroying",
    });

    db.update(environments)
      .set({ updatedAt: now - 8 * 24 * 60 * 60_000 })
      .where(eq(environments.id, staleEnvironment.id))
      .run();

    const spy: DbNotifier = {
      notifyThread: vi.fn(),
      notifyEnvironment: vi.fn(),
      notifyHost: vi.fn(),
      notifyCommand: vi.fn(),
      notifyProject: vi.fn(),
      notifySystem: vi.fn(),
    };

    const result = sweepDestroyingEnvironments(db, spy, now);
    expect(result.deleted).toBe(1);
    expect(
      db
        .select()
        .from(environments)
        .all()
        .map((row) => row.id),
    ).toEqual([freshEnvironment.id]);
    expect(spy.notifyEnvironment).toHaveBeenCalledWith(staleEnvironment.id, [
      "environment-deleted",
    ]);
  });
});
