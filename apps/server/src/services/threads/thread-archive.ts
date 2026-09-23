import {
  cancelProviderEnvironmentCreation,
  sweepProviderEnvironment,
} from "../environments/environment-engine.js";
import {
  removeCreatingMachine,
  sweepProviderMachine,
} from "../machines/provider-orchestration.js";
import {
  listLiveThreadsInEnvironment,
  listLifecycleThreadDependents,
  archiveThread,
  getEnvironment,
  listNonDeletedChildThreads,
  listNonDeletedHiddenSourceThreads,
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
  requestThreadStopForCurrentState,
} from "./thread-lifecycle.js";
import {
  archiveUndoGraceKeepsTerminals,
  archiveUndoGraceKeepsTurnRunning,
} from "./archive-undo-grace.js";
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

  const now = Date.now();
  if (!archiveUndoGraceKeepsTerminals(archivedThread, now)) {
    deps.terminalSessions.closeArchivedThreadTerminals({
      threadId: archivedThread.id,
    });
  }
  if (!archiveUndoGraceKeepsTurnRunning(archivedThread, now)) {
    requestThreadStopForCurrentState(deps, archivedThread, args.environment);
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
  void removeCreatingMachine(deps, archivedThread.id).catch((error) =>
    deps.logger.warn({ error }, "Machine launch cancellation failed"),
  );
  if (archivedThread.environmentId !== null)
    void sweepProviderEnvironment(deps, archivedThread.environmentId).catch(
      (error) => deps.logger.warn({ error }, "Environment retirement failed"),
    );
  if (args.environment !== null) {
    void sweepProviderMachine(deps, args.environment.hostId).catch((error) =>
      deps.logger.warn({ error }, "Machine retirement failed"),
    );
  }
  emitPluginThreadArchived(archivedThread);

  return archivedThread;
}

export function archiveEnvironmentThreads(
  deps: AppDeps,
  args: ArchiveEnvironmentThreadsArgs,
): string[] {
  const roots = listLiveThreadsInEnvironment(deps.db, {
    environmentId: args.environment.id,
  });
  return archiveThreadTrees(deps, roots, (thread) =>
    thread.environmentId === null
      ? null
      : getEnvironment(deps.db, thread.environmentId),
  );
}

export function archiveThreadAndChildren(
  deps: AppDeps,
  args: ArchiveThreadAndChildrenArgs,
): string[] {
  const environment = resolveArchiveThreadEnvironment(deps, {
    thread: args.parentThread,
  });
  return archiveThreadTrees(deps, [args.parentThread], (thread) =>
    thread.id === args.parentThread.id
      ? environment
      : thread.environmentId === null
        ? null
        : getEnvironment(deps.db, thread.environmentId),
  );
}

function archiveThreadTrees(
  deps: AppDeps,
  roots: Thread[],
  resolveEnvironment: (
    thread: ArchiveThreadWithLifecycleEffectsArgs["thread"],
  ) => ArchiveThreadEnvironment | null,
): string[] {
  type ArchiveCandidate = Pick<
    Thread,
    "id" | "environmentId" | "status" | "archivedAt" | "deletedAt"
  >;
  const pending: { thread: ArchiveCandidate; expanded: boolean }[] = [...roots]
    .reverse()
    .map((thread) => ({ thread, expanded: false }));
  const visited = new Set<string>();
  const threads: ArchiveCandidate[] = [];

  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry) {
      break;
    }
    const { thread, expanded } = entry;
    if (expanded) {
      threads.push(thread);
      continue;
    }
    if (visited.has(thread.id)) {
      continue;
    }
    visited.add(thread.id);
    pending.push({ thread, expanded: true });
    const descendants = [
      ...listLifecycleThreadDependents(deps.db, thread.id),
      ...listNonDeletedChildThreads(deps.db, {
        parentThreadId: thread.id,
      }),
      ...listNonDeletedHiddenSourceThreads(deps.db, {
        sourceThreadId: thread.id,
      }),
    ];
    for (const descendant of descendants.reverse()) {
      pending.push({ thread: descendant, expanded: false });
    }
  }
  for (const root of roots) archiveThread(deps.db, deps.hub, root.id);
  const archivedThreadIds: string[] = [];

  for (const thread of threads) {
    if (thread.deletedAt !== null) continue;
    if (thread.archivedAt !== null) {
      if (!archiveUndoGraceKeepsTurnRunning(thread, Date.now()))
        requestThreadStopForCurrentState(
          deps,
          thread,
          thread.environmentId === null ? null : resolveEnvironment(thread),
        );
      continue;
    }
    const environment = resolveEnvironment(thread);
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
