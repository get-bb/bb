import { eq } from "drizzle-orm";
import {
  closeSession,
  getActiveSession,
  hostDaemonSessions,
  listHostThreadIds,
  type HostDaemonSessionRow,
  type SweepExpiredLeasesResult,
} from "@bb/db";
import type { HostDaemonActiveThread } from "@bb/host-daemon-contract";
import {
  DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS,
  DAEMON_DISCONNECT_GRACE_MS,
} from "../constants.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../types.js";
import {
  interruptActiveThreadsForHost,
  reconcileDaemonReportedThreads,
} from "../services/threads/thread-lifecycle.js";
import { settleDanglingBackgroundTasks } from "../services/threads/background-task-reconciliation.js";
import { WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON } from "../services/workflows/workflow-run-lifecycle.js";
import {
  interruptAbandonedWorkflowRuns,
  reconcileDaemonReportedWorkflowRuns,
} from "../services/workflows/workflow-run-reconciliation.js";

const DAEMON_RESTARTED_PENDING_INTERACTION_REASON =
  "Host daemon restarted while awaiting user interaction; retry the thread to continue";
const DAEMON_DISCONNECTED_PENDING_INTERACTION_REASON =
  "Host daemon disconnected while awaiting user interaction; retry the thread to continue";
const DAEMON_SESSION_EXPIRED_PENDING_INTERACTION_REASON =
  "Host daemon session expired while awaiting user interaction; retry the thread to continue";

type HostSessionOpenedDeps = LoggedPendingInteractionWorkSessionDeps;
type DaemonSocketClosedDeps = Pick<
  AppDeps,
  "db" | "hub" | "logger" | "pendingInteractions" | "terminalSessions"
>;
// Lease expiry interrupts abandoned workflow runs, which needs the full
// lifecycle dep set (manager paused messages); the disconnect-grace path
// keeps the narrow set because workflows deliberately take no action there.
type ExpiredHostSessionLeaseDeps = LoggedPendingInteractionWorkSessionDeps;
type DaemonDisconnectGraceDeps = Pick<
  AppDeps,
  "db" | "hub" | "logger" | "pendingInteractions"
>;

export interface HandleHostSessionOpenedArgs {
  activeThreads: HostDaemonActiveThread[];
  /**
   * Heartbeat-verified live workflow run ids reported by the daemon (a run is
   * reported iff a live runner handle exists or its run-dir heartbeat is
   * fresh) — the reconnect-reconciliation input.
   */
  activeWorkflowRunIds: readonly string[];
  hostId: string;
  openedSession: HostDaemonSessionRow;
  /**
   * The host's most recent session before this open, regardless of status —
   * a daemon crash closes its session immediately on socket close, so the
   * restarted-daemon reconciliation below must not require the previous
   * session to still be active.
   */
  previousSession: HostDaemonSessionRow | null;
}

export interface HandleDaemonSocketClosedArgs {
  sessionId: string;
}

interface CompleteDaemonDisconnectGraceArgs {
  hostId: string;
}

interface CompleteDaemonActiveWorkDisconnectGraceArgs {
  hostId: string;
}

export interface HandleExpiredHostSessionLeasesArgs {
  expiredLeases: SweepExpiredLeasesResult;
}

export async function handleHostSessionOpened(
  deps: HostSessionOpenedDeps,
  args: HandleHostSessionOpenedArgs,
): Promise<void> {
  deps.logger.info(
    {
      sessionId: args.openedSession.id,
      hostId: args.hostId,
      replacedSessionId: args.previousSession?.id ?? null,
    },
    "Session opened",
  );

  if (
    args.previousSession &&
    args.previousSession.id !== args.openedSession.id
  ) {
    deps.hub.cancelPendingDaemonDisconnect(args.previousSession.id);

    if (args.previousSession.status === "active") {
      deps.hub.closeDaemonSession(args.previousSession.id, "replaced");
    }

    interruptPendingInteractionsForHostThreads(deps, {
      hostId: args.hostId,
      reason:
        args.previousSession.instanceId === args.openedSession.instanceId
          ? DAEMON_DISCONNECTED_PENDING_INTERACTION_REASON
          : DAEMON_RESTARTED_PENDING_INTERACTION_REASON,
    });

    if (args.previousSession.instanceId !== args.openedSession.instanceId) {
      interruptActiveThreadsForHost(deps, {
        hostId: args.hostId,
        reason: "host-daemon-restarted",
      });
      // The restarted daemon lost its in-memory background-task state and the
      // CLI processes died with it — settle the persisted open items. This
      // also covers restarts inside the disconnect grace window, where the
      // grace callback sees the new active session and skips its settle.
      settleDanglingBackgroundTasks(deps, { hostId: args.hostId });
    }
  }

  await reconcileDaemonReportedThreads(deps, {
    activeThreadIds: args.activeThreads.map((thread) => thread.threadId),
    hostId: args.hostId,
  });
  // Unconditional (not gated on the instanceId discriminator): the daemon's
  // activeWorkflowRunIds is heartbeat-verified, so reported runs are
  // demonstrably alive on same-instance reconnects (sleep/blip) and across
  // restarts alike, while unreported running runs must be interrupted either
  // way.
  await reconcileDaemonReportedWorkflowRuns(deps, {
    activeWorkflowRunIds: args.activeWorkflowRunIds,
    hostId: args.hostId,
  });
}

export function handleDaemonSocketClosed(
  deps: DaemonSocketClosedDeps,
  args: HandleDaemonSocketClosedArgs,
): void {
  deps.logger.info({ sessionId: args.sessionId }, "Daemon WebSocket closed");
  deps.hub.unregisterDaemon(args.sessionId);
  deps.terminalSessions.handleDaemonSessionClosed({
    sessionId: args.sessionId,
  });

  const session = deps.db
    .select()
    .from(hostDaemonSessions)
    .where(eq(hostDaemonSessions.id, args.sessionId))
    .get();
  if (!session || session.status !== "active") {
    return;
  }

  // Close the session immediately so host availability reflects the disconnect.
  // Active turns are reconciled only after a same-process reconnect has had the
  // live event window to drain, or when a different daemon instance registers.
  closeSession(deps.db, deps.hub, args.sessionId, "daemon-disconnect");

  notifyHostThreadRuntimeStatusChanged(deps, session.hostId);
  deps.hub.scheduleDaemonDisconnect(
    args.sessionId,
    DAEMON_DISCONNECT_GRACE_MS,
    () =>
      completeDaemonDisconnectGrace(deps, {
        hostId: session.hostId,
      }),
  );
  deps.hub.scheduleDaemonActiveWorkDisconnect(
    args.sessionId,
    DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS,
    () =>
      completeDaemonActiveWorkDisconnectGrace(deps, {
        hostId: session.hostId,
      }),
  );
}

export function handleExpiredHostSessionLeases(
  deps: ExpiredHostSessionLeaseDeps,
  args: HandleExpiredHostSessionLeasesArgs,
): void {
  if (args.expiredLeases.expiredSessionIds.length === 0) {
    return;
  }

  for (const sessionId of args.expiredLeases.expiredSessionIds) {
    deps.hub.closeDaemonSession(sessionId, "expired");
  }
  for (const hostId of args.expiredLeases.expiredHostIds) {
    if (!getActiveSession(deps.db, hostId)) {
      interruptPendingInteractionsForHostThreads(deps, {
        hostId,
        reason: DAEMON_SESSION_EXPIRED_PENDING_INTERACTION_REASON,
      });
      // A host that never reconnects has no re-register to settle its open
      // background tasks; mirror the pending-interaction reconciliation here
      // so lost workflows do not dangle as running forever.
      settleDanglingBackgroundTasks(deps, { hostId });
      // The settle-as-interrupted backstop for workflow runs: the lease
      // lapsed with no replacement session, so the daemon is demonstrably
      // gone. Runs become `interrupted` (resumable; revived if the daemon
      // returns reporting them alive) and their anchor items get the paused
      // snapshot — never a completed row.
      interruptAbandonedWorkflowRuns(deps, {
        hostId,
        reason: WORKFLOW_RUN_HOST_SESSION_EXPIRED_REASON,
      });
    }
    notifyHostThreadRuntimeStatusChanged(deps, hostId);
  }
}

function completeDaemonDisconnectGrace(
  deps: DaemonDisconnectGraceDeps,
  args: CompleteDaemonDisconnectGraceArgs,
): void {
  if (getActiveSession(deps.db, args.hostId)) {
    return;
  }

  interruptPendingInteractionsForHostThreads(deps, {
    hostId: args.hostId,
    reason: DAEMON_DISCONNECTED_PENDING_INTERACTION_REASON,
  });
  // Same policy as pending interactions: after the grace window the daemon is
  // treated as gone, so its background tasks are settled. If the daemon was
  // alive-but-partitioned, its later real progress/completed events supersede
  // the settle row (latest state row per item wins). Workflow runs
  // deliberately take NO action here: connection loss alone does not prove
  // active runs are gone — they stay `running` until session-open
  // reconciliation or the lease-expiry backstop interrupts them.
  settleDanglingBackgroundTasks(deps, { hostId: args.hostId });
  notifyHostThreadRuntimeStatusChanged(deps, args.hostId);
}

function completeDaemonActiveWorkDisconnectGrace(
  deps: Pick<AppDeps, "db" | "hub" | "pendingInteractions">,
  args: CompleteDaemonActiveWorkDisconnectGraceArgs,
): void {
  if (getActiveSession(deps.db, args.hostId)) {
    return;
  }

  interruptActiveThreadsForHost(deps, {
    hostId: args.hostId,
    reason: "host-daemon-restarted",
  });
}

function notifyHostThreadRuntimeStatusChanged(
  deps: Pick<AppDeps, "db" | "hub">,
  hostId: string,
): void {
  for (const threadId of listHostThreadIds(deps.db, { hostId })) {
    deps.hub.notifyThread(threadId, ["status-changed"]);
  }
}

function interruptPendingInteractionsForHostThreads(
  deps: Pick<AppDeps, "db" | "pendingInteractions">,
  args: { hostId: string; reason: string },
): void {
  deps.pendingInteractions.interruptPendingInteractionsForThreadIds({
    threadIds: listHostThreadIds(deps.db, { hostId: args.hostId }),
    reason: args.reason,
  });
}
