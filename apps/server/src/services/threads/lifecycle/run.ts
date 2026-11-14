import {
  getActiveStoredTurnId,
  getEnvironment,
  getLatestStoredThreadEventOfTypes,
  getLatestThreadSequence,
  getThread,
  readThreadRunState,
  writeThreadLifecycleStateInTransaction,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
  type StoredThreadRunState,
} from "@bb/db";
import {
  threadScope,
  turnScope,
  type Thread,
  type ThreadEventType,
} from "@bb/domain";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../../types.js";
import { NotificationBuffer } from "../../lib/notification-buffer.js";
import {
  appendSystemErrorEventInTransaction,
  appendThreadEventInTransaction,
  getLastProviderThreadId,
} from "../thread-events.js";
import { getThreadProvisionContext } from "../thread-startup-store.js";
import { settleDanglingBackgroundTasksForStoppedThreadInTransaction } from "../background-task-reconciliation.js";
import {
  transitionThreadLifecycle,
  type RuntimeInterruptionReason,
  type ThreadLifecycleEffect,
  type ThreadLifecycleInput,
  type ThreadLifecycleRefusal,
  type ThreadLifecycleState,
  type ThreadLifecycleTransition,
} from "./machine.js";

export interface ThreadLifecycleTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
  logger: AppDeps["logger"];
}

type ThreadRow = NonNullable<ReturnType<typeof getThread>>;

export interface ThreadLifecycleOutcome {
  effects: ThreadLifecycleEffect[];
  previousStatus: Thread["status"] | null;
  refusal: ThreadLifecycleRefusal | "not-found" | null;
  statusChanged: boolean;
  stopRoute: ThreadLifecycleTransition["stopRoute"];
  thread: ThreadRow | null;
  threadId: string;
}

const POST_COMMIT_EFFECT_KINDS: ReadonlySet<ThreadLifecycleEffect["kind"]> =
  new Set([
    "abort-plugin-tool-calls",
    "archive-provider-session",
    "clear-provision-schedule",
    "drain-queue",
    "end-pending-interactions",
    "notify-parent",
    "prune-idle",
    "redeliver-steer",
    "send-stop",
    "sync-title",
    "turn-ended",
  ]);

export function isPostCommitLifecycleEffect(
  effect: ThreadLifecycleEffect,
): boolean {
  return POST_COMMIT_EFFECT_KINDS.has(effect.kind);
}

export function loadThreadLifecycleState(
  db: DbQueryConnection,
  thread: ThreadRow,
): { state: ThreadLifecycleState; stored: StoredThreadRunState } {
  const stored = readThreadRunState(db, thread.id);
  return {
    state: {
      ...stored,
      activeTurnId: getActiveStoredTurnId(db, thread.id),
      archived: thread.archivedAt !== null,
      deleted: thread.deletedAt !== null,
      provisioning: getThreadProvisionContext(db, thread.id) !== null,
      status: thread.status,
    },
    stored,
  };
}

export function pendingInteractionStopReason(
  reason: RuntimeInterruptionReason | "thread-deleted",
): string {
  switch (reason) {
    case "thread-deleted":
      return "thread-deleted";
    case "host-removed":
      return "Thread stopped because the machine was removed";
    case "manual-stop":
      return "Thread stopped by user request";
    case "host-daemon-restarted":
      return "Host daemon restarted while awaiting user interaction";
    case "host-connection-lost":
      return "Connection to host was lost while awaiting user interaction";
    case "provider-turn-idle":
      return "Thread stopped after the provider stopped sending progress";
  }
}

function hasInterruptedEvent(db: DbQueryConnection, threadId: string): boolean {
  return (
    getLatestStoredThreadEventOfTypes(db, {
      afterSequence: 0,
      threadId,
      types: ["system/thread/interrupted"],
    }) !== null
  );
}

function applyTransactionEffect(
  deps: ThreadLifecycleTransactionDeps,
  thread: ThreadRow,
  effect: ThreadLifecycleEffect,
  appended: Set<ThreadEventType>,
): void {
  switch (effect.kind) {
    case "append-turn-interrupted": {
      const providerThreadId = getLastProviderThreadId(deps, thread.id);
      appendThreadEventInTransaction(deps.db, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerThreadId,
        type: "turn/completed",
        scope: turnScope(effect.turnId),
        data: {
          providerThreadId,
          status: "interrupted",
          ...(effect.providerCheckpointId !== null
            ? { providerCheckpointId: effect.providerCheckpointId }
            : {}),
        },
      });
      appended.add("turn/completed");
      return;
    }
    case "append-interruption":
      if (effect.onlyIfMissing && hasInterruptedEvent(deps.db, thread.id)) {
        return;
      }
      appendThreadEventInTransaction(deps.db, {
        threadId: thread.id,
        type: "system/thread/interrupted",
        scope: threadScope(),
        data: {
          reason: effect.reason,
          ...(effect.cause !== null ? { cause: effect.cause } : {}),
        },
      });
      appended.add("system/thread/interrupted");
      return;
    case "append-request-rejected":
      appendThreadEventInTransaction(deps.db, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        type: "client/turn/rejected",
        scope: threadScope(),
        data: {
          requestId: effect.requestId,
          reason: effect.reason,
          message: effect.message,
        },
      });
      appended.add("client/turn/rejected");
      return;
    case "append-system-error":
      appendSystemErrorEventInTransaction(deps, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        code: effect.code,
        message: effect.message,
        ...(effect.detail !== null ? { detail: effect.detail } : {}),
        scope: effect.turnId !== null ? turnScope(effect.turnId) : threadScope(),
      });
      return;
    case "settle-background-tasks":
      settleDanglingBackgroundTasksForStoppedThreadInTransaction(deps, {
        threadId: thread.id,
      });
      return;
    case "record-empty-fork-session":
      appendThreadEventInTransaction(deps.db, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerThreadId: effect.providerThreadId,
        type: "thread/identity",
        scope: threadScope(),
        data: { providerThreadId: effect.providerThreadId },
      });
      appendThreadEventInTransaction(deps.db, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerThreadId: effect.providerThreadId,
        type: "system/thread-provisioning",
        scope: threadScope(),
        data: {
          provisioningId: `thread-start:${effect.executionId}`,
          status: "completed",
          environmentId: thread.environmentId,
          entries: [],
        },
      });
      appended.add("thread/identity");
      appended.add("system/thread-provisioning");
      return;
    default:
      return;
  }
}

export function runThreadLifecycleInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  threadId: string,
  input: ThreadLifecycleInput,
): ThreadLifecycleOutcome {
  const thread = getThread(deps.db, threadId);
  if (thread === null) {
    return {
      effects: [],
      previousStatus: null,
      refusal: "not-found",
      statusChanged: false,
      stopRoute: "none",
      thread: null,
      threadId,
    };
  }
  const { state, stored } = loadThreadLifecycleState(deps.db, thread);
  const transition = transitionThreadLifecycle(state, input);
  if (transition.refusal !== null) {
    deps.logger.info(
      {
        input: input.type,
        refusal: transition.refusal,
        status: state.status,
        threadId,
      },
      "Thread lifecycle input refused",
    );
    return {
      effects: [],
      previousStatus: state.status,
      refusal: transition.refusal,
      statusChanged: false,
      stopRoute: transition.stopRoute,
      thread,
      threadId,
    };
  }
  const written = writeThreadLifecycleStateInTransaction(deps.db, {
    expectedStatus: state.status,
    next: transition.next,
    previous: stored,
    threadId,
  });
  if (written.kind === "conflict") {
    throw new Error(
      `Thread ${threadId} lifecycle state changed during ${input.type}`,
    );
  }
  const appended = new Set<ThreadEventType>();
  const postCommit: ThreadLifecycleEffect[] = [];
  for (const effect of transition.effects) {
    if (isPostCommitLifecycleEffect(effect)) {
      postCommit.push(effect);
    } else {
      applyTransactionEffect(deps, written.thread, effect, appended);
    }
  }
  if (appended.size > 0) {
    deps.hub.notifyThread(threadId, ["events-appended"], {
      timelineSequence: getLatestThreadSequence(deps.db, { threadId }),
      eventTypes: [...appended],
    });
  }
  return {
    effects: postCommit,
    previousStatus: state.status,
    refusal: null,
    statusChanged: written.statusChanged,
    stopRoute: transition.stopRoute,
    thread: written.thread,
    threadId,
  };
}

export function runThreadLifecycleTransaction(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
  input: ThreadLifecycleInput,
): ThreadLifecycleOutcome {
  const notifications = new NotificationBuffer();
  const outcome = deps.db.transaction(
    (tx) =>
      runThreadLifecycleInTransaction(
        { ...deps, db: tx, hub: notifications },
        threadId,
        input,
      ),
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  return outcome;
}

export function environmentForThread(
  db: DbQueryConnection,
  thread: Pick<ThreadRow, "environmentId">,
): { hostId: string; id: string } | null {
  if (thread.environmentId === null) return null;
  const environment = getEnvironment(db, thread.environmentId);
  return environment === null
    ? null
    : { hostId: environment.hostId, id: environment.id };
}
