import {
  disableThreadSchedulesByThread,
  listLiveThreadsInEnvironment,
  listUnarchivedAssignedChildThreads,
} from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  wouldCleanupEnvironment,
} from "../environments/environment-cleanup-internal.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../system/event-pruning.js";
import {
  dispatchSettledArchivedThreadProviderArchiveCommand,
  requestActiveRuntimeThreadStopIfNeeded,
} from "./thread-lifecycle.js";
import { archiveThreadAndReleaseChildren } from "./thread-ownership.js";
import { requireThreadHostCommandEnvironment } from "./thread-command-environment.js";

interface ArchiveThreadWithLifecycleEffectsArgs {
  environment: {
    hostId: string;
    id: string;
  };
  thread: Pick<Thread, "environmentId" | "id" | "status">;
}

interface ArchiveEnvironmentThreadsArgs {
  environment: Environment;
}

interface ArchiveThreadAndChildrenArgs {
  parentThread: Thread;
}

export function archiveThreadWithLifecycleEffects(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
): Thread | null {
  const archivedThread = archiveThreadAndReleaseChildren(deps, {
    threadId: args.thread.id,
  });
  if (!archivedThread) {
    return null;
  }

  // Archiving pauses scheduled work. Unarchive keeps schedules disabled until
  // the user intentionally re-enables them.
  disableThreadSchedulesByThread(deps.db, deps.hub, {
    now: Date.now(),
    projectId: archivedThread.projectId,
    threadId: archivedThread.id,
  });

  deps.terminalSessions.closeArchivedThreadTerminals({
    threadId: archivedThread.id,
  });
  // Archive only stops active runtime work; manual stop is the pre-start
  // provisioning cancellation entrypoint.
  requestActiveRuntimeThreadStopIfNeeded(deps, archivedThread, args.environment);
  dispatchSettledArchivedThreadProviderArchiveCommand(deps, {
    threadId: archivedThread.id,
  });
  resetActiveThreadEventPruningState(archivedThread.id);
  pruneThreadEventHistoryBestEffort(deps, {
    mode: "archived",
    threadId: archivedThread.id,
  });

  return archivedThread;
}

export function archiveEnvironmentThreads(
  deps: AppDeps,
  args: ArchiveEnvironmentThreadsArgs,
): string[] {
  const threads = listLiveThreadsInEnvironment(deps.db, {
    environmentId: args.environment.id,
  });
  const archivedThreadIds: string[] = [];

  for (const thread of threads) {
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment: args.environment,
      thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.id);
  }

  if (
    archivedThreadIds.length > 0 &&
    wouldCleanupEnvironment(deps, {
      environmentId: args.environment.id,
    })
  ) {
    requestEnvironmentCleanup(deps, {
      environmentId: args.environment.id,
    });
    requestEnvironmentCleanupAdvance(deps, {
      environmentId: args.environment.id,
    });
  }

  return archivedThreadIds;
}

export function archiveThreadAndChildren(
  deps: AppDeps,
  args: ArchiveThreadAndChildrenArgs,
): string[] {
  const childThreads = listUnarchivedAssignedChildThreads(deps.db, {
    parentThreadId: args.parentThread.id,
  });
  const threads: ArchiveThreadWithLifecycleEffectsArgs["thread"][] =
    childThreads.filter((thread) => thread.id !== args.parentThread.id);
  if (args.parentThread.archivedAt === null) {
    threads.push(args.parentThread);
  }
  const archivedThreadIds: string[] = [];
  const affectedEnvironmentIds = new Set<string>();

  for (const thread of threads) {
    const environment = requireThreadHostCommandEnvironment({
      db: deps.db,
      thread,
    });
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment,
      thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.id);
    affectedEnvironmentIds.add(environment.id);
  }

  for (const environmentId of affectedEnvironmentIds) {
    if (
      wouldCleanupEnvironment(deps, {
        environmentId,
      })
    ) {
      requestEnvironmentCleanup(deps, { environmentId });
      requestEnvironmentCleanupAdvance(deps, { environmentId });
    }
  }

  return archivedThreadIds;
}
