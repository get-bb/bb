import {
  listLiveThreadsInEnvironment,
  listUnarchivedAssignedChildThreads,
  listUnarchivedHiddenSourceThreads,
} from "@bb/db";
import type { Environment, Thread } from "@bb/domain";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
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

interface ArchiveThreadWithLifecycleEffectsArgs {
  environment: {
    hostId: string;
    id: string;
  };
  thread: Pick<Thread, "environmentId" | "id" | "status">;
}

interface ApplyArchivedThreadLifecycleEffectsArgs {
  environment: {
    hostId: string;
    id: string;
  };
  thread: Thread;
}

interface ArchiveEnvironmentThreadsArgs {
  environment: Environment;
}

interface ArchiveThreadAndChildrenArgs {
  parentThread: Thread;
}

export function applyArchivedThreadLifecycleEffects(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: ApplyArchivedThreadLifecycleEffectsArgs,
): void {
  deps.terminalSessions.closeArchivedThreadTerminals({
    threadId: args.thread.id,
  });
  // Archive only stops active runtime work; manual stop is the pre-start
  // provisioning cancellation entrypoint.
  requestActiveRuntimeThreadStopIfNeeded(deps, args.thread, args.environment);
  dispatchSettledArchivedThreadProviderArchiveCommand(deps, {
    threadId: args.thread.id,
  });
  resetActiveThreadEventPruningState(args.thread.id);
  pruneThreadEventHistoryBestEffort(deps, {
    mode: "archived",
    threadId: args.thread.id,
  });
  emitPluginThreadArchived(args.thread);
}

export function applyArchivedThreadLifecycleEffectsBestEffort(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: ApplyArchivedThreadLifecycleEffectsArgs,
): boolean {
  // These archive operations already reconcile current state and are safe to
  // repeat. A crash or an incomplete batch can replay the whole list until the
  // handoff's durable completion marker is written.
  const effects: Array<{ label: string; run: () => void }> = [
    {
      label: "close archived source terminals",
      run: () =>
        deps.terminalSessions.closeArchivedThreadTerminals({
          threadId: args.thread.id,
        }),
    },
    {
      label: "stop archived source runtime",
      run: () =>
        requestActiveRuntimeThreadStopIfNeeded(
          deps,
          args.thread,
          args.environment,
        ),
    },
    {
      label: "archive source provider thread",
      run: () => {
        dispatchSettledArchivedThreadProviderArchiveCommand(deps, {
          threadId: args.thread.id,
        });
      },
    },
    {
      label: "reset source event pruning state",
      run: () => resetActiveThreadEventPruningState(args.thread.id),
    },
    {
      label: "prune archived source events",
      run: () => {
        const pruned = pruneThreadEventHistoryBestEffort(deps, {
          mode: "archived",
          threadId: args.thread.id,
        });
        if (pruned === null) {
          throw new Error("Archived source event pruning did not complete");
        }
      },
    },
    {
      label: "emit source archived plugin event",
      run: () => emitPluginThreadArchived(args.thread),
    },
  ];
  let allSucceeded = true;
  for (const effect of effects) {
    try {
      effect.run();
    } catch (error) {
      allSucceeded = false;
      deps.logger.warn(
        { err: error, threadId: args.thread.id },
        `Failed to ${effect.label} for thread handoff`,
      );
    }
  }
  return allSucceeded;
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

  applyArchivedThreadLifecycleEffects(deps, {
    environment: args.environment,
    thread: archivedThread,
  });

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
      environment: requireThreadHostCommandEnvironment({
        db: deps.db,
        thread: fork,
      }),
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
