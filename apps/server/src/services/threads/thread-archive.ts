import {
  cancelProviderEnvironmentCreation,
  sweepProviderEnvironment,
} from "../environments/provider-orchestration.js";
import {
  listLiveThreadsInEnvironment,
  listNonDeletedChildThreads,
  listUnarchivedHiddenSourceThreads,
} from "@bb/db";
import type { EnvironmentRow } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../lib/lifecycle-api-errors.js";
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
import { getThreadProvisionContext } from "./thread-startup-store.js";
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
  environment: EnvironmentRow;
}

interface ArchiveThreadAndChildrenArgs {
  parentThread: Thread;
}

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
    getThreadProvisionContext(deps.db, args.thread.id) !== null
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
  void cancelProviderEnvironmentCreation(deps, archivedThread.id).catch(
    (error) =>
      deps.logger.warn({ error }, "Environment launch cancellation failed"),
  );
  if (archivedThread.environmentId !== null)
    void sweepProviderEnvironment(deps, archivedThread.environmentId).catch(
      (error) => deps.logger.warn({ error }, "Environment retirement failed"),
    );
  emitPluginThreadArchived(archivedThread);

  return archivedThread;
}

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

  return archivedThreadIds;
}

export function archiveThreadAndChildren(
  deps: AppDeps,
  args: ArchiveThreadAndChildrenArgs,
): string[] {
  type ArchiveCandidate = Pick<
    Thread,
    "id" | "environmentId" | "status" | "archivedAt"
  >;
  const pending: { thread: ArchiveCandidate; expanded: boolean }[] = [
    { thread: args.parentThread, expanded: false },
  ];
  const visited = new Set<string>();
  const threads: ArchiveCandidate[] = [];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) {
      break;
    }
    const { thread, expanded } = entry;
    if (expanded) {
      if (thread.archivedAt === null) {
        threads.push(thread);
      }
      continue;
    }
    if (visited.has(thread.id)) {
      continue;
    }
    visited.add(thread.id);
    pending.push({ thread, expanded: true });
    const descendants = [
      ...listNonDeletedChildThreads(deps.db, {
        parentThreadId: thread.id,
      }),
      ...listUnarchivedHiddenSourceThreads(deps.db, {
        sourceThreadId: thread.id,
      }),
    ];
    for (const descendant of descendants.reverse()) {
      pending.push({ thread: descendant, expanded: false });
    }
  }
  const archivedThreadIds: string[] = [];

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
  }

  return archivedThreadIds;
}
