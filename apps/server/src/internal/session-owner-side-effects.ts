import { eq } from "drizzle-orm";
import {
  closeSession,
  hostDaemonSessions,
  listActiveHostThreads,
  listHostThreadIds,
  type HostDaemonSessionRow,
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
import { buildThreadStatusChangeMetadataByThreadId } from "../services/threads/thread-runtime-display.js";
import { settleDanglingBackgroundTasks } from "../services/threads/background-task-reconciliation.js";

const DAEMON_RESTARTED_PENDING_INTERACTION_REASON =
  "Host daemon restarted while awaiting user interaction; retry the thread to continue";
const DAEMON_DISCONNECTED_PENDING_INTERACTION_REASON =
  "Host daemon disconnected while awaiting user interaction; retry the thread to continue";

type HostSessionOpenedDeps = LoggedPendingInteractionWorkSessionDeps;
type DaemonSocketClosedDeps = Pick<
  AppDeps,
  | "db"
  | "hub"
  | "logger"
  | "pendingInteractions"
  | "providerRegistry"
  | "sharedPorts"
  | "terminalSessions"
>;
type DaemonDisconnectGraceDeps = Pick<
  AppDeps,
  | "db"
  | "hub"
  | "logger"
  | "pendingInteractions"
  | "providerRegistry"
  | "terminalSessions"
>;

interface HandleHostSessionOpenedArgs {
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

interface HandleDaemonSocketClosedArgs {
  sessionId: string;
}

interface HandleHostRemovedArgs {
  hostId: string;
  sessionId: string;
}

interface CompleteDaemonDisconnectGraceArgs {
  hostId: string;
}

interface CompleteDaemonActiveWorkDisconnectGraceArgs {
  hostId: string;
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
    const sameDaemonInstance =
      args.previousSession.instanceId === args.openedSession.instanceId;
    deps.hub.cancelPendingDaemonDisconnect(args.previousSession.id);

    if (args.previousSession.status === "active") {
      if (sameDaemonInstance) {
        // A reconnect opens the replacement session before its new WebSocket.
        // Close only the superseded socket: sending session-close would make
        // this same daemon shut down every resident provider runtime.
        deps.hub.closeDaemonSessionSocket(args.previousSession.id, "replaced");
      } else {
        deps.hub.closeDaemonSession(args.previousSession.id, "replaced");
      }
      deps.terminalSessions.handleDaemonSessionClosed({
        sessionId: args.previousSession.id,
      });
    }

    interruptPendingInteractionsForHostThreads(deps, {
      hostId: args.hostId,
      reason: sameDaemonInstance
        ? DAEMON_DISCONNECTED_PENDING_INTERACTION_REASON
        : DAEMON_RESTARTED_PENDING_INTERACTION_REASON,
    });

    if (!sameDaemonInstance) {
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
}

export function handleDaemonSocketClosed(
  deps: DaemonSocketClosedDeps,
  args: HandleDaemonSocketClosedArgs,
): void {
  deps.logger.info({ sessionId: args.sessionId }, "Daemon WebSocket closed");
  deps.hub.unregisterDaemon(args.sessionId);
  deps.sharedPorts.clearHostConnectCapability(args.sessionId);

  const session = deps.db
    .select()
    .from(hostDaemonSessions)
    .where(eq(hostDaemonSessions.id, args.sessionId))
    .get();
  if (!session || session.status !== "active") {
    return;
  }
  deps.terminalSessions.handleDaemonSessionClosed({
    sessionId: args.sessionId,
  });

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

/**
 * Host removal is an immediate, terminal disconnect: it cannot use the normal
 * reconnect grace because the host is tombstoned in the same request. Closing
 * the DB session first makes the later WebSocket close callback a no-op for
 * owner side-effects, so this explicit path performs them exactly once.
 */
export function handleHostRemoved(
  deps: DaemonSocketClosedDeps,
  args: HandleHostRemovedArgs,
): void {
  const session = deps.db
    .select()
    .from(hostDaemonSessions)
    .where(eq(hostDaemonSessions.id, args.sessionId))
    .get();
  if (
    !session ||
    session.status !== "active" ||
    session.hostId !== args.hostId
  ) {
    return;
  }

  closeSession(deps.db, deps.hub, args.sessionId, "expired");
  deps.hub.closeDaemonSession(args.sessionId, "expired");
  deps.terminalSessions.handleDaemonSessionClosed({
    sessionId: args.sessionId,
  });
  interruptPendingInteractionsForHostThreads(deps, {
    hostId: args.hostId,
    reason: DAEMON_DISCONNECTED_PENDING_INTERACTION_REASON,
  });
  interruptActiveThreadsForHost(deps, {
    hostId: args.hostId,
    reason: "host-daemon-restarted",
  });
  settleDanglingBackgroundTasks(deps, { hostId: args.hostId });
  notifyHostThreadRuntimeStatusChanged(deps, args.hostId);
}

function completeDaemonDisconnectGrace(
  deps: DaemonDisconnectGraceDeps,
  args: CompleteDaemonDisconnectGraceArgs,
): void {
  if (deps.hub.hasDaemonForHost(args.hostId)) {
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

function completeDaemonActiveWorkDisconnectGrace(
  deps: Pick<
    AppDeps,
    "db" | "hub" | "logger" | "pendingInteractions" | "providerRegistry"
  >,
  args: CompleteDaemonActiveWorkDisconnectGraceArgs,
): void {
  if (deps.hub.hasDaemonForHost(args.hostId)) {
    return;
  }

  interruptActiveThreadsForHost(deps, {
    hostId: args.hostId,
    reason: "host-daemon-restarted",
  });
}

/**
 * Host connectivity is part of an `active` thread row's displayed runtime, so
 * those rows' notifications carry the post-change `statusChange` snapshot
 * clients patch in place instead of refetching every active thread list.
 * Every other row renders the same whether or not the host is connected; it
 * keeps the bare notification it always received, which clients coalesce into
 * one throttled list refetch. The snapshots come from one batched pass: this
 * runs synchronously in the daemon socket's close handler and again when the
 * grace elapses, and a host can carry hundreds of threads.
 */
function notifyHostThreadRuntimeStatusChanged(
  deps: Pick<AppDeps, "db" | "hub" | "providerRegistry">,
  hostId: string,
): void {
  const metadataByThreadId = buildThreadStatusChangeMetadataByThreadId(deps, {
    environmentHostId: hostId,
    threads: listActiveHostThreads(deps.db, { hostId }),
  });
  for (const threadId of listHostThreadIds(deps.db, { hostId })) {
    deps.hub.notifyThread(
      threadId,
      ["status-changed"],
      metadataByThreadId.get(threadId),
    );
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
