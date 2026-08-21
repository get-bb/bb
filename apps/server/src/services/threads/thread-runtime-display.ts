import {
  getEnvironment,
  getLatestSessionForHost,
  getSessionById,
  listActiveBackgroundTaskCountsByThreadIds,
  listLatestThreadStateEventRowsByThreadIds,
  listLatestSessionsForHosts,
  listOpenTurnInputAcceptedRowsByThreadIds,
  listStoredClientTurnRequestRowsByKeys,
  type DbConnection,
  type HostDaemonSessionRow,
  type StoredEventRow,
  type ThreadClientTurnRequestKey,
  type ThreadWithPendingInteractionState,
} from "@bb/db";
import { LEGACY_CODEX_GOAL_EXTENSION_KIND } from "@bb/domain";
import type {
  Thread,
  ThreadActivityState,
  ThreadListEntry,
  ThreadRuntimeState,
  ThreadStatus,
  ThreadWithRuntime,
} from "@bb/domain";
import {
  extractThreadTimelineActivePlanTurn,
  extractThreadTimelineGoal,
  type ThreadEventWithMeta,
} from "@bb/thread-view";
import type { ThreadResponse } from "@bb/server-contract";
import { DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS } from "../../constants.js";
import type { NotificationHub } from "../../ws/hub.js";
import { resolveProviderPlanCommand } from "../providers/provider-plan-command.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { canThreadSpawnChild } from "./thread-parent.js";
import { toThreadEventWithMeta } from "./timeline.js";

type ThreadRuntimeDisplayHub = Pick<
  NotificationHub,
  "getDaemonSessionIdForHost"
>;

interface ThreadRuntimeDisplayDeps {
  db: DbConnection;
  hub: ThreadRuntimeDisplayHub;
}

/**
 * The prompt-banner path additionally needs the registry, because plan-mode
 * eligibility is the provider's declared plan composer command. Kept separate
 * so the plain runtime-state callers (plugin DTOs, thread-send) are not forced
 * to carry a registry they never read.
 */
interface ThreadPromptBannerDeps extends ThreadRuntimeDisplayDeps {
  providerRegistry: ProviderRegistryService;
}

interface ResolveThreadRuntimeStateArgs {
  environmentHostId: string | null;
  now?: number;
  status: ThreadStatus;
}

interface ResolveThreadRuntimeStateFromLatestSessionArgs {
  environmentHostId: string | null;
  hostConnected: boolean;
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
  activity: ThreadActivityState;
  hostConnected: boolean;
  latestSession: HostDaemonSessionRow | null;
  now?: number;
  thread: ThreadWithPendingInteractionState;
}

interface PromptBannerActivityState extends Pick<
  ThreadActivityState,
  "activeGoalCount" | "activePlanModeCount"
> {
  activePlanTurnId: string | null;
}

const EMPTY_THREAD_ACTIVITY: ThreadActivityState = {
  activeBackgroundAgentCount: 0,
  activeBackgroundCommandCount: 0,
  activeGoalCount: 0,
  activePlanModeCount: 0,
  activeWorkflowCount: 0,
};

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

/**
 * Only computed for `active` threads: an active turn survives a daemon
 * disconnect until the active-work grace elapses, so that is the reconnect
 * window the DTO advertises. The shorter DAEMON_DISCONNECT_GRACE_MS window
 * only settles pending interactions and background tasks.
 */
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
  return session.closedAt + DAEMON_ACTIVE_WORK_DISCONNECT_GRACE_MS;
}

function hasOpenDaemonSessionForHost(
  deps: ThreadRuntimeDisplayDeps,
  hostId: string,
): boolean {
  const sessionId = deps.hub.getDaemonSessionIdForHost(hostId);
  if (!sessionId) {
    return false;
  }
  const session = getSessionById(deps.db, { sessionId });
  return session?.hostId === hostId && session.status === "active";
}

function toPublicThread(thread: Thread): Thread {
  return {
    id: thread.id,
    projectId: thread.projectId,
    environmentId: thread.environmentId,
    providerId: thread.providerId,
    title: thread.title,
    titleFallback: thread.titleFallback,
    sectionId: thread.sectionId,
    status: thread.status,
    parentThreadId: thread.parentThreadId,
    sourceThreadId: thread.sourceThreadId,
    originKind: thread.originKind,
    originPluginId: thread.originPluginId,
    visibility: thread.visibility,
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
  if (args.status !== "active" || args.environmentHostId === null) {
    return threadStatusRuntimeState(args.status);
  }

  const hostConnected = hasOpenDaemonSessionForHost(
    deps,
    args.environmentHostId,
  );
  const latestSession = hostConnected
    ? null
    : getLatestSessionForHost(deps.db, {
        hostId: args.environmentHostId,
      });
  return resolveThreadRuntimeStateFromLatestSession({
    environmentHostId: args.environmentHostId,
    hostConnected,
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

  if (args.hostConnected) {
    return threadStatusRuntimeState("active");
  }

  const now = args.now ?? Date.now();
  const latestSession = args.latestSession;
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

function toThreadResponseWithHost(
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
): ThreadResponse {
  const threadWithRuntime = toThreadResponseWithHost(deps, {
    ...args,
    environmentHostId: resolveThreadEnvironmentHostId(deps, args.thread),
  });
  return {
    ...threadWithRuntime,
    activeBackgroundAgentCount:
      listActiveBackgroundTaskCountsByThreadIds(deps.db, {
        threadIds: [args.thread.id],
      })[0]?.activeBackgroundAgentCount ?? 0,
    canSpawnChild: canThreadSpawnChild(deps, { thread: args.thread }),
  };
}

function getThreadPromptBannerActivityState(
  deps: ThreadPromptBannerDeps,
  thread: Thread,
  events: readonly ThreadEventWithMeta[],
): PromptBannerActivityState {
  const activePlanTurn = extractThreadTimelineActivePlanTurn({
    events,
    planCommand: resolveProviderPlanCommand(
      deps.providerRegistry,
      thread.providerId,
    ),
    providerId: thread.providerId,
    threadStatus: thread.status,
  });
  const goal = extractThreadTimelineGoal(events);

  return {
    activeGoalCount: goal?.status === "active" ? 1 : 0,
    activePlanModeCount: activePlanTurn === null ? 0 : 1,
    activePlanTurnId: activePlanTurn?.turnId ?? null,
  };
}

// Pre-filter for the banner query: only threads whose provider declares a
// plan command can have an active plan turn, so the rest are not event-loaded.
function canThreadShowActivePlanMode(
  deps: ThreadPromptBannerDeps,
  thread: Thread,
): boolean {
  return (
    thread.status === "active" &&
    resolveProviderPlanCommand(deps.providerRegistry, thread.providerId) !==
      null
  );
}

function listPromptBannerActivityCandidateRows(
  deps: ThreadPromptBannerDeps,
  threads: readonly Thread[],
): StoredEventRow[] {
  const latestGoalRows = listLatestThreadStateEventRowsByThreadIds(deps.db, {
    threadIds: threads.map((thread) => thread.id),
    kind: LEGACY_CODEX_GOAL_EXTENSION_KIND,
  });
  const openAcceptedRows = listOpenTurnInputAcceptedRowsByThreadIds(deps.db, {
    threadIds: threads
      .filter((thread) => canThreadShowActivePlanMode(deps, thread))
      .map((thread) => thread.id),
  });
  const openAcceptedEvents = openAcceptedRows.map(toThreadEventWithMeta);
  const requestKeys: ThreadClientTurnRequestKey[] = openAcceptedEvents.flatMap(
    ({ event }) =>
      event.type === "turn/input/accepted"
        ? [{ requestId: event.clientRequestId, threadId: event.threadId }]
        : [],
  );
  const requestRows = listStoredClientTurnRequestRowsByKeys(deps.db, {
    keys: requestKeys,
  });

  return [...latestGoalRows, ...openAcceptedRows, ...requestRows].sort(
    (left, right) =>
      left.threadId.localeCompare(right.threadId) ||
      left.sequence - right.sequence,
  );
}

function buildThreadPromptBannerActivityByThreadId(
  deps: ThreadPromptBannerDeps,
  threads: readonly Thread[],
): Map<string, PromptBannerActivityState> {
  const rows = listPromptBannerActivityCandidateRows(deps, threads);
  const eventsByThreadId = new Map<string, ThreadEventWithMeta[]>();
  for (const row of rows) {
    const threadEvents = eventsByThreadId.get(row.threadId);
    const event = toThreadEventWithMeta(row);
    if (threadEvents) {
      threadEvents.push(event);
    } else {
      eventsByThreadId.set(row.threadId, [event]);
    }
  }

  const result = new Map<string, PromptBannerActivityState>();
  for (const thread of threads) {
    const activity = getThreadPromptBannerActivityState(
      deps,
      thread,
      eventsByThreadId.get(thread.id) ?? [],
    );
    if (activity.activeGoalCount > 0 || activity.activePlanModeCount > 0) {
      result.set(thread.id, activity);
    }
  }
  return result;
}

export function getThreadPromptBannerActivity(
  deps: ThreadPromptBannerDeps,
  thread: Thread,
): PromptBannerActivityState {
  return (
    buildThreadPromptBannerActivityByThreadId(deps, [thread]).get(
      thread.id,
    ) ?? {
      activeGoalCount: 0,
      activePlanModeCount: 0,
      activePlanTurnId: null,
    }
  );
}

export function toThreadListEntryResponses(
  deps: ThreadPromptBannerDeps,
  args: ToThreadListEntryResponsesArgs,
): ThreadListEntry[] {
  const backgroundTaskActivityByThreadId = new Map(
    listActiveBackgroundTaskCountsByThreadIds(deps.db, {
      threadIds: args.threads.map((thread) => thread.id),
    }).map((activity) => [activity.threadId, activity]),
  );
  const promptBannerActivityByThreadId =
    buildThreadPromptBannerActivityByThreadId(deps, args.threads);
  const activeHostIds = [
    ...new Set(
      args.threads.flatMap((thread) =>
        thread.status === "active" && thread.environmentHostId !== null
          ? [thread.environmentHostId]
          : [],
      ),
    ),
  ];
  const connectedActiveHostIds = new Set(
    activeHostIds.filter((hostId) => hasOpenDaemonSessionForHost(deps, hostId)),
  );
  const latestSessionByHostId = new Map(
    listLatestSessionsForHosts(deps.db, {
      hostIds: activeHostIds.filter(
        (hostId) => !connectedActiveHostIds.has(hostId),
      ),
    }).map((session) => [session.hostId, session]),
  );

  return args.threads.map((thread) => {
    const backgroundActivity = backgroundTaskActivityByThreadId.get(thread.id);
    const promptBannerActivity = promptBannerActivityByThreadId.get(thread.id);
    return toThreadListEntryResponseFromLatestSession({
      activity: {
        activeBackgroundAgentCount:
          backgroundActivity?.activeBackgroundAgentCount ??
          EMPTY_THREAD_ACTIVITY.activeBackgroundAgentCount,
        activeBackgroundCommandCount:
          backgroundActivity?.activeBackgroundCommandCount ??
          EMPTY_THREAD_ACTIVITY.activeBackgroundCommandCount,
        activeGoalCount:
          promptBannerActivity?.activeGoalCount ??
          EMPTY_THREAD_ACTIVITY.activeGoalCount,
        activePlanModeCount:
          promptBannerActivity?.activePlanModeCount ??
          EMPTY_THREAD_ACTIVITY.activePlanModeCount,
        activeWorkflowCount:
          backgroundActivity?.activeWorkflowCount ??
          EMPTY_THREAD_ACTIVITY.activeWorkflowCount,
      },
      hostConnected:
        thread.environmentHostId !== null &&
        connectedActiveHostIds.has(thread.environmentHostId),
      latestSession:
        thread.environmentHostId === null
          ? null
          : (latestSessionByHostId.get(thread.environmentHostId) ?? null),
      now: args.now,
      thread,
    });
  });
}

function toThreadListEntryResponseFromLatestSession(
  args: ToThreadListEntryResponseFromLatestSessionArgs,
): ThreadListEntry {
  const thread = toPublicThread(args.thread);
  return {
    ...thread,
    activity: args.activity,
    pinSortKey: args.thread.pinSortKey,
    environmentBranchName: args.thread.environmentBranchName,
    environmentHostId: args.thread.environmentHostId,
    environmentName: args.thread.environmentName,
    environmentWorkspaceDisplayKind:
      args.thread.environmentWorkspaceDisplayKind,
    hasPendingInteraction: args.thread.hasPendingInteraction,
    runtime: resolveThreadRuntimeStateFromLatestSession({
      environmentHostId: args.thread.environmentHostId,
      hostConnected: args.hostConnected,
      latestSession: args.latestSession,
      now: args.now,
      status: thread.status,
    }),
  };
}
