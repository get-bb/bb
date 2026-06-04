import { eq } from "drizzle-orm";
import {
  closeSession,
  getActiveSession,
  hostDaemonSessions,
  listHostThreadIds,
  requeueFetchedCommandsForSession,
  type HostDaemonSessionRow,
  type SweepExpiredLeasesResult,
} from "@bb/db";
import type { HostDaemonActiveThread } from "@bb/host-daemon-contract";
import { DAEMON_DISCONNECT_GRACE_MS } from "../constants.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../types.js";
import { reconcileDaemonReportedThreads } from "../services/threads/thread-lifecycle.js";
import { settleDanglingBackgroundTasks } from "../services/threads/background-task-reconciliation.js";

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
type ExpiredHostSessionLeaseDeps = Pick<
  AppDeps,
  "db" | "hub" | "logger" | "pendingInteractions"
>;

export interface HandleHostSessionOpenedArgs {
  activeThreads: HostDaemonActiveThread[];
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
  sessionId: string;
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
    if (args.previousSession.status === "active") {
      deps.hub.closeDaemonSession(args.previousSession.id, "replaced");
    }

    if (args.previousSession.instanceId !== args.openedSession.instanceId) {
      if (args.previousSession.status === "active") {
        // A different instanceId is a new daemon process: the prior process is
        // gone and cannot report the commands it had fetched. Return them to
        // the queue now so the restarted daemon re-fetches them, instead of
        // waiting out the delivery lease (up to 20min for provision).
        // Same-instance reconnects keep the lease as a safety window, since a
        // blipped-but-alive daemon may still report the original attempt.
        // Already-closed previous sessions are excluded: their threads are
        // interrupted by the disconnect/lease reconciliation, and requeueing
        // would replay stale work on top of the interruption.
        const requeued = requeueFetchedCommandsForSession(deps.db, {
          sessionId: args.previousSession.id,
        });
        if (requeued.requeued > 0) {
          deps.hub.notifyCommand(args.hostId);
        }
      }
      interruptPendingInteractionsForHostThreads(deps, {
        hostId: args.hostId,
        reason: DAEMON_RESTARTED_PENDING_INTERACTION_REASON,
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

  // Close the session immediately so the host status reflects the disconnect
  // right away. Thread runtime status is notified immediately and again after
  // grace, but connection loss alone does not prove active turns are gone.
  closeSession(deps.db, deps.hub, args.sessionId, "daemon-disconnect");

  notifyHostThreadRuntimeStatusChanged(deps, session.hostId);
  deps.hub.scheduleDaemonDisconnect(
    args.sessionId,
    DAEMON_DISCONNECT_GRACE_MS,
    () =>
      completeDaemonDisconnectGrace(deps, {
        hostId: session.hostId,
        sessionId: args.sessionId,
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
    }
    notifyHostThreadRuntimeStatusChanged(deps, hostId);
  }
}

function completeDaemonDisconnectGrace(
  deps: ExpiredHostSessionLeaseDeps,
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
  // the settle row (latest state row per item wins).
  settleDanglingBackgroundTasks(deps, { hostId: args.hostId });
  notifyHostThreadRuntimeStatusChanged(deps, args.hostId);
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
