import {
  requestEnvironmentRemoval,
  sweepProviderEnvironment,
} from "../environments/environment-engine.js";
import { cancelAbandonedProviderCreations } from "../threads/thread-environment-providers.js";
import {
  deleteProject,
  getProject,
  getEnvironment,
  hasProjectThreads,
  listDeletedProjectIds,
  listEnvironments,
  listProjectDeletionThreads,
  markProjectDeleted,
  markThreadDeleted,
  type ProjectDeletionThreadRow,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../../types.js";
import { deleteProjectAttachments } from "./attachments.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import {
  finalizeStoppedThread,
  requestThreadStorageDeletion,
} from "../threads/thread-lifecycle.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { emitPluginThreadDeleted } from "../plugins/plugin-thread-events.js";

interface ProjectDeletionArgs {
  projectId: string;
}

type ProjectDeletionDeps = LoggedPendingInteractionWorkSessionDeps &
  Pick<AppDeps, "terminalSessions">;

function isProjectDeletionActive(
  deps: Pick<AppDeps, "db">,
  projectId: string,
): boolean {
  return getProject(deps.db, projectId)?.deletedAt !== null;
}

function tombstoneProjectThreadsForDeletion(
  deps: ProjectDeletionDeps,
  args: ProjectDeletionArgs,
): { deletedThreads: Thread[]; projectThreads: ProjectDeletionThreadRow[] } {
  const notificationBuffer = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) => {
      markProjectDeleted(tx, notificationBuffer, {
        projectId: args.projectId,
      });

      const deletedThreads: Thread[] = [];
      const threadsForDeletion = listProjectDeletionThreads(tx, args);
      for (const thread of threadsForDeletion) {
        if (thread.deletedAt === null) {
          const deletedThread = markThreadDeleted(tx, notificationBuffer, {
            threadId: thread.id,
          });
          if (deletedThread) deletedThreads.push(deletedThread);
        }
      }
      return { deletedThreads, projectThreads: threadsForDeletion };
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  for (const thread of result.deletedThreads) {
    emitPluginThreadDeleted(thread);
    cancelAbandonedProviderCreations(deps, thread.id);
  }
  return result;
}

export function beginProjectDeletion(
  deps: ProjectDeletionDeps,
  args: ProjectDeletionArgs,
): void {
  if (!getProject(deps.db, args.projectId)) {
    return;
  }

  const projectEnvironments = listEnvironments(deps.db, {
    projectId: args.projectId,
  });
  const environmentsById = new Map(
    projectEnvironments.map((environment) => [environment.id, environment]),
  );
  const { projectThreads } = tombstoneProjectThreadsForDeletion(deps, args);
  for (const thread of projectThreads) {
    const environment = thread.environmentId
      ? (environmentsById.get(thread.environmentId) ??
        getEnvironment(deps.db, thread.environmentId))
      : null;
    requestProjectThreadStorageDeletion(deps, thread, environment);
  }
}

function requestProjectThreadStorageDeletion(
  deps: ProjectDeletionDeps,
  thread: ProjectDeletionThreadRow,
  environment: { hostId: string; id: string } | null,
): void {
  if (thread.storageDeletedAt === null) {
    requestThreadStorageDeletion(deps, thread, environment);
  } else if (thread.purgeRequestedAt === null) {
    finalizeStoppedThread(deps, { fence: false, threadId: thread.id });
  }
}

export function requestProjectDeletionAdvance(
  deps: ProjectDeletionDeps,
  args: ProjectDeletionArgs,
): void {
  deferAfterResponse({
    config: deps.config,
    context: {
      projectId: args.projectId,
    },
    logger: deps.logger,
    name: "Project deletion advance request",
    work: async () => {
      await advanceProjectDeletion(deps, args);
    },
  });
}

export async function advanceProjectDeletion(
  deps: ProjectDeletionDeps,
  args: ProjectDeletionArgs,
): Promise<boolean> {
  if (!isProjectDeletionActive(deps, args.projectId)) {
    return false;
  }

  if (!getProject(deps.db, args.projectId)) {
    return true;
  }

  const projectEnvironments = listEnvironments(deps.db, {
    projectId: args.projectId,
  });
  const environmentsById = new Map(
    projectEnvironments.map((environment) => [environment.id, environment]),
  );
  const projectThreads = listProjectDeletionThreads(deps.db, {
    projectId: args.projectId,
  });
  for (const thread of projectThreads) {
    const environment = thread.environmentId
      ? (environmentsById.get(thread.environmentId) ??
        getEnvironment(deps.db, thread.environmentId))
      : null;

    if (thread.deletedAt === null) {
      const deletedThread = markThreadDeleted(deps.db, deps.hub, {
        threadId: thread.id,
      });
      if (deletedThread) emitPluginThreadDeleted(deletedThread);
    }
    cancelAbandonedProviderCreations(deps, thread.id);
    deps.terminalSessions.closeDeletedThreadTerminals({ threadId: thread.id });
    requestProjectThreadStorageDeletion(deps, thread, environment);
  }

  if (hasProjectThreads(deps.db, args.projectId)) {
    return false;
  }

  for (const environment of projectEnvironments) {
    if (environment.environmentProviderId === null) continue;
    if (!requestEnvironmentRemoval(deps, environment.id)) return false;
    await sweepProviderEnvironment(deps, environment.id);
    const current = getEnvironment(deps.db, environment.id);
    if (current !== null && current.teardownStatus !== "removed") return false;
  }
  deleteProject(deps.db, deps.hub, args.projectId);
  await deleteProjectAttachments(deps.config.dataDir, args.projectId);
  return true;
}

export function listProjectsPendingDeletion(
  deps: Pick<AppDeps, "db">,
): string[] {
  return listDeletedProjectIds(deps.db);
}
