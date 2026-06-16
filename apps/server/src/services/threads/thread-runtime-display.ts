import {
  getEnvironment,
  getLatestSessionForHost,
  listLatestSessionsForHosts,
  type DbConnection,
  type HostDaemonSessionRow,
  type ThreadWithPendingInteractionState,
} from "@bb/db";
import type {
  Thread,
  ThreadListEntry,
  ThreadRuntimeState,
  ThreadStatus,
  ThreadWithRuntime,
} from "@bb/domain";
import { DAEMON_DISCONNECT_GRACE_MS } from "../../constants.js";

interface ThreadRuntimeDisplayDeps {
  db: DbConnection;
}

interface ResolveThreadRuntimeStateArgs {
  environmentHostId: string | null;
  now?: number;
  status: ThreadStatus;
}

interface ResolveThreadRuntimeStateFromLatestSessionArgs {
  environmentHostId: string | null;
  latestSession: HostDaemonSessionRow | null;
  now?: number;
  status: ThreadStatus;
}

interface ToThreadResponseFromThreadArgs {
  now?: number;
  thread: Thread;
}

interface ToThreadResponseWithHostArgs extends ToThreadResponseFromThreadArgs {
  environmentHostId: string | null;
}

interface ToThreadListEntryResponsesArgs {
  now?: number;
  threads: readonly ThreadWithPendingInteractionState[];
}

interface ToThreadListEntryResponseFromLatestSessionArgs {
  latestSession: HostDaemonSessionRow | null;
  now?: number;
  thread: ThreadWithPendingInteractionState;
}

function threadStatusRuntimeState(status: ThreadStatus): ThreadRuntimeState {
  switch (status) {
    case "starting":
    case "idle":
    case "active":
    case "stopping":
    case "error":
      return {
        displayStatus: status,
        hostReconnectGraceExpiresAt: null,
      };
  }
}

function getDaemonDisconnectGraceExpiresAt(
  session: HostDaemonSessionRow,
): number | null {
  if (session.status !== "closed") {
    return null;
  }
  if (session.closeReason !== "daemon-disconnect") {
    return null;
  }
  if (session.closedAt === null) {
    return null;
  }
  return session.closedAt + DAEMON_DISCONNECT_GRACE_MS;
}

function toPublicThread(thread: Thread): Thread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    environmentId: thread.environmentId,
    providerId: thread.providerId,
    title: thread.title,
    titleFallback: thread.titleFallback,
    status: thread.status,
    parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt,
    pinnedAt: thread.pinnedAt,
    deletedAt: thread.deletedAt,
    lastReadAt: thread.lastReadAt,
    latestAttentionAt: thread.latestAttentionAt,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

export function resolveThreadRuntimeState(
  deps: ThreadRuntimeDisplayDeps,
  args: ResolveThreadRuntimeStateArgs,
): ThreadRuntimeState {
  const latestSession =
    args.status === "active" && args.environmentHostId !== null
      ? getLatestSessionForHost(deps.db, {
          hostId: args.environmentHostId,
        })
      : null;
  return resolveThreadRuntimeStateFromLatestSession({
    environmentHostId: args.environmentHostId,
    latestSession,
    now: args.now,
    status: args.status,
  });
}

function resolveThreadRuntimeStateFromLatestSession(
  args: ResolveThreadRuntimeStateFromLatestSessionArgs,
): ThreadRuntimeState {
  if (args.status !== "active" || args.environmentHostId === null) {
    return threadStatusRuntimeState(args.status);
  }

  const now = args.now ?? Date.now();
  const latestSession = args.latestSession;
  if (
    latestSession &&
    latestSession.status === "active" &&
    latestSession.leaseExpiresAt > now
  ) {
    return threadStatusRuntimeState("active");
  }

  if (latestSession) {
    const graceExpiresAt = getDaemonDisconnectGraceExpiresAt(latestSession);
    if (graceExpiresAt !== null && graceExpiresAt > now) {
      return {
        displayStatus: "host-reconnecting",
        hostReconnectGraceExpiresAt: graceExpiresAt,
      };
    }
  }

  return {
    displayStatus: "waiting-for-host",
    hostReconnectGraceExpiresAt: null,
  };
}

function resolveThreadEnvironmentHostId(
  deps: ThreadRuntimeDisplayDeps,
  thread: Thread,
): string | null {
  if (thread.environmentId === null) {
    return null;
  }
  return getEnvironment(deps.db, thread.environmentId)?.hostId ?? null;
}

export function toThreadResponseWithHost(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadResponseWithHostArgs,
): ThreadWithRuntime {
  const thread = toPublicThread(args.thread);
  return {
    ...thread,
    runtime: resolveThreadRuntimeState(deps, {
      environmentHostId: args.environmentHostId,
      now: args.now,
      status: thread.status,
    }),
  };
}

export function toThreadResponseFromThread(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadResponseFromThreadArgs,
): ThreadWithRuntime {
  return toThreadResponseWithHost(deps, {
    ...args,
    environmentHostId: resolveThreadEnvironmentHostId(deps, args.thread),
  });
}

export function toThreadListEntryResponses(
  deps: ThreadRuntimeDisplayDeps,
  args: ToThreadListEntryResponsesArgs,
): ThreadListEntry[] {
  const activeHostIds = [
    ...new Set(
      args.threads.flatMap((thread) =>
        thread.status === "active" && thread.environmentHostId !== null
          ? [thread.environmentHostId]
          : [],
      ),
    ),
  ];
  const latestSessionByHostId = new Map(
    listLatestSessionsForHosts(deps.db, { hostIds: activeHostIds }).map(
      (session) => [session.hostId, session],
    ),
  );

  return args.threads.map((thread) =>
    toThreadListEntryResponseFromLatestSession({
      latestSession:
        thread.environmentHostId === null
          ? null
          : (latestSessionByHostId.get(thread.environmentHostId) ?? null),
      now: args.now,
      thread,
    }),
  );
}

function toThreadListEntryResponseFromLatestSession(
  args: ToThreadListEntryResponseFromLatestSessionArgs,
): ThreadListEntry {
  const thread = toPublicThread(args.thread);
  return {
    ...thread,
    pinSortKey: args.thread.pinSortKey,
    environmentBranchName: args.thread.environmentBranchName,
    environmentHostId: args.thread.environmentHostId,
    environmentName: args.thread.environmentName,
    environmentWorkspaceDisplayKind:
      args.thread.environmentWorkspaceDisplayKind,
    hasPendingInteraction: args.thread.hasPendingInteraction,
    runtime: resolveThreadRuntimeStateFromLatestSession({
      environmentHostId: args.thread.environmentHostId,
      latestSession: args.latestSession,
      now: args.now,
      status: thread.status,
    }),
  };
}
