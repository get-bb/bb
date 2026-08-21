import {
  listLiveThreadsInEnvironment,
  listUnarchivedAssignedChildThreads,
  listUnarchivedHiddenSourceThreads,
} from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
import {
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  wouldCleanupEnvironment,
} from "../environments/environment-cleanup-internal.js";
import {
  pruneThreadEventHistoryBestEffort,
  resetActiveThreadEventPruningState,
} from "../system/event-pruning.js";
import { emitPluginThreadArchived } from "../plugins/plugin-thread-events.js";
import {
  dispatchSettledArchivedThreadProviderArchiveCommand,
  requestActiveRuntimeThreadStopIfNeeded,
} from "./thread-lifecycle.js";
import { archiveThreadAndReleaseChildren } from "./thread-ownership.js";
import { requireThreadHostCommandEnvironment } from "./thread-command-environment.js";
import { getActiveThreadProvisionContext } from "./thread-provisioning-active-context.js";
import { isPreStartThreadStatus } from "./thread-status.js";

interface ArchiveThreadEnvironment {
  hostId: string;
  id: string;
}

interface ArchiveThreadWithLifecycleEffectsArgs {
  environment: ArchiveThreadEnvironment | null;
  thread: Pick<Thread, "environmentId" | "id" | "status">;
}

interface ResolveArchiveThreadEnvironmentArgs {
  thread: ArchiveThreadWithLifecycleEffectsArgs["thread"];
}

interface ArchiveEnvironmentThreadsArgs {
  environment: Environment;
}

interface ArchiveThreadAndChildrenArgs {
  parentThread: Thread;
}

/**
 * Resolve the environment archive needs to stop the thread's live work, or
 * null when there is nothing to stop. A thread loses its environment pointer
 * when the environment row is pruned (threads.environment_id is ON DELETE SET
 * NULL); that thread is settled and archivable without an environment. A
 * pointer-less thread whose setup is still in flight (its environment row does
 * not exist yet) keeps the refusal: archive does not cancel setup, so admitting
 * it would let setup create an environment for an archived thread.
 */
export function resolveArchiveThreadEnvironment(
  deps: Pick<AppDeps, "db">,
  args: ResolveArchiveThreadEnvironmentArgs,
): ArchiveThreadEnvironment | null {
  if (args.thread.environmentId !== null) {
    return requireThreadHostCommandEnvironment({
      db: deps.db,
      thread: args.thread,
    });
  }
  if (
    isPreStartThreadStatus(args.thread.status) ||
    args.thread.status === "stopping" ||
    getActiveThreadProvisionContext(args.thread.id) !== null
  ) {
    throwThreadEnvironmentUnavailable(
      threadEnvironmentUnavailableDetails("never_attached", null),
    );
  }
  return null;
}

function archiveThreadWithLifecycleEffects(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
): Thread | null {
  const archivedThread = archiveThreadAndReleaseChildren(deps, {
    threadId: args.thread.id,
  });
  if (!archivedThread) {
    return null;
  }

  deps.terminalSessions.closeArchivedThreadTerminals({
    threadId: archivedThread.id,
  });
  // Archive only stops active runtime work; manual stop is the pre-start
  // provisioning cancellation entrypoint. A thread whose environment row was
  // pruned has no runtime left to stop.
  if (args.environment !== null) {
    requestActiveRuntimeThreadStopIfNeeded(
      deps,
      archivedThread,
      args.environment,
    );
  }
  dispatchSettledArchivedThreadProviderArchiveCommand(deps, {
    threadId: archivedThread.id,
  });
  resetActiveThreadEventPruningState(archivedThread.id);
  pruneThreadEventHistoryBestEffort(deps, {
    mode: "archived",
    threadId: archivedThread.id,
  });
  emitPluginThreadArchived(archivedThread);

  return archivedThread;
}

/**
 * Archive one thread plus the hidden forks that retire with it. A hidden fork
 * (a side chat, say) has no row of its own to reach, so it must not outlive its
 * source. Structural rather than plugin-owned: archiving cannot depend on
 * whichever plugin created the fork still being enabled.
 */
export function archiveThreadAndHiddenSourceForks(
  deps: AppDeps,
  args: ArchiveThreadWithLifecycleEffectsArgs,
): Thread | null {
  const archivedThread = archiveThreadWithLifecycleEffects(deps, args);
  if (!archivedThread) {
    return null;
  }
  for (const fork of listUnarchivedHiddenSourceThreads(deps.db, {
    sourceThreadId: archivedThread.id,
  })) {
    archiveThreadWithLifecycleEffects(deps, {
      environment: resolveArchiveThreadEnvironment(deps, { thread: fork }),
      thread: fork,
    });
  }
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
  // Collected here rather than through archiveThreadAndHiddenSourceForks so
  // every cascaded id lands in this route's response.
  const hiddenSourceThreads = listUnarchivedHiddenSourceThreads(deps.db, {
    sourceThreadId: args.parentThread.id,
  });
  const threads: ArchiveThreadWithLifecycleEffectsArgs["thread"][] = [
    ...childThreads,
    ...hiddenSourceThreads,
  ].filter((thread) => thread.id !== args.parentThread.id);
  if (args.parentThread.archivedAt === null) {
    threads.push(args.parentThread);
  }
  const archivedThreadIds: string[] = [];
  const affectedEnvironmentIds = new Set<string>();

  for (const thread of threads) {
    const environment = resolveArchiveThreadEnvironment(deps, { thread });
    const result = archiveThreadWithLifecycleEffects(deps, {
      environment,
      thread,
    });
    if (!result) {
      continue;
    }
    archivedThreadIds.push(result.id);
    if (environment !== null) {
      affectedEnvironmentIds.add(environment.id);
    }
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
