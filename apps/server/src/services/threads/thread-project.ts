import {
  countLiveThreadsInEnvironment,
  countInactiveThreadEnvironmentReferences,
  countThreadEnvironmentReferences,
  createEnvironment,
  createEnvironmentProvisionRequest,
  createThreadProvisioningId,
  findForeignManagedEnvironmentAtHostPath,
  findProjectEnvironmentByHostPath,
  getProject,
  getEnvironment,
  getEnvironmentProvisionRequest,
  getThread,
  getProjectSourceByHost,
  listNonDeletedChildThreads,
  setThreadExecutionOverride,
  updateEnvironmentProject,
  type DbQueryConnection,
  type DbNotifier,
  updateThread,
  type ThreadExecutionOverride,
  type UpdateThreadInput,
} from "@bb/db";
import { z } from "zod";
import { PERSONAL_PROJECT_ID, type Environment, type Thread } from "@bb/domain";
import type { ProjectRow } from "@bb/db";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  advanceEnvironmentProvisioning,
  interruptUnrecoverableEnvironmentProvisioning,
} from "../environments/environment-provisioning-internal.js";
import { buildDirectEnvironmentProvisionRequest } from "../environments/environment-provision-request.js";
import {
  requestEnvironmentCleanup,
  runEnvironmentCleanupAdvance,
} from "../environments/environment-cleanup-internal.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  buildEnvironmentProvisionCommand,
  buildManagedBranchName,
  SETUP_TIMEOUT_MS,
} from "./thread-create-helpers.js";
import {
  tryAcquireThreadOperation,
  tryAcquireThreadOperations,
} from "./thread-operation-lock.js";
import { tryAcquireEnvironmentOperations } from "./environment-operation-lock.js";
import { resolveManagedTargetPath } from "./worktree-paths.js";
import { assertValidParentThread } from "./thread-parent.js";

interface MoveThreadToProjectArgs {
  additionalThreadIds?: readonly string[];
  metadata: Omit<UpdateThreadInput, "environmentId" | "projectId">;
  executionOverride?: ThreadExecutionOverride;
  targetProject: Pick<ProjectRow, "id">;
  thread: Thread;
}

const managedWorkspaceProvisionJobSchema = z.object({
  branchName: z.string().min(1),
  environmentId: z.string().min(1),
  hostId: z.string().min(1),
  projectSourcePath: z.string().min(1),
  provisioningId: z.string().min(1),
  threadId: z.string().min(1),
});
type ManagedWorkspaceProvisionJob = z.infer<
  typeof managedWorkspaceProvisionJobSchema
>;

function moveConflict(message: string): never {
  throw new ApiError(409, "invalid_request", message);
}

function collectThreadSubtree(db: DbQueryConnection, root: Thread): Thread[] {
  const result: Thread[] = [root];
  const pending = [root.id];
  const seen = new Set([root.id]);

  while (pending.length > 0) {
    const parentThreadId = pending.shift();
    if (!parentThreadId) continue;
    for (const child of listNonDeletedChildThreads(db, { parentThreadId })) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push(child);
      pending.push(child.id);
    }
  }

  return result;
}

function requireReadyEnvironment(
  environment: Environment,
): Environment & { path: string; status: "ready" } {
  if (environment.status !== "ready" || environment.path === null) {
    moveConflict(
      "This thread cannot move while its workspace is not ready. Wait for workspace setup to finish and try again.",
    );
  }
  return {
    ...environment,
    path: environment.path,
    status: "ready",
  };
}

function requireCompatibleTargetEnvironment(
  environment: Environment,
  source: Environment,
): void {
  if (
    environment.status !== "ready" ||
    environment.path === null ||
    environment.workspaceProvisionType !== source.workspaceProvisionType
  ) {
    moveConflict(
      "The destination project already has an incompatible workspace at this path.",
    );
  }
  if (
    source.workspaceProvisionType === "managed-worktree" &&
    !environment.managed
  ) {
    moveConflict(
      "The destination project already has an unmanaged workspace at this path.",
    );
  }
}

function createManagedWorkspaceEnvironment(
  db: DbQueryConnection,
  hub: DbNotifier,
  args: {
    hostId: string;
    projectId: string;
    projectSourcePath: string;
    sourceEnvironmentId: string;
    threadId: string;
  },
  onManagedWorkspaceCreated: (job: ManagedWorkspaceProvisionJob) => void,
): string {
  const branchName = buildManagedBranchName({
    branchSlug: `moved-${args.sourceEnvironmentId}`,
    threadId: args.threadId,
  });
  const created = createEnvironment(db, hub, {
    baseBranch: null,
    branchName,
    hostId: args.hostId,
    isGitRepo: false,
    isWorktree: false,
    managed: true,
    path: null,
    projectId: args.projectId,
    status: "provisioning",
    workspaceProvisionType: "managed-worktree",
  });
  onManagedWorkspaceCreated({
    branchName,
    environmentId: created.id,
    hostId: args.hostId,
    projectSourcePath: args.projectSourcePath,
    provisioningId: createThreadProvisioningId(),
    threadId: args.threadId,
  });
  return created.id;
}

function resolveTargetEnvironment(
  db: DbQueryConnection,
  hub: DbNotifier,
  args: {
    externalReferenceCount: number;
    inactiveExternalReferenceCount: number;
    source: Environment;
    threadId: string;
    targetProject: Pick<ProjectRow, "id">;
  },
  onManagedWorkspaceCreated: (job: ManagedWorkspaceProvisionJob) => void,
): string {
  const source = requireReadyEnvironment(args.source);
  const targetIsPersonal = args.targetProject.id === PERSONAL_PROJECT_ID;

  if (source.workspaceProvisionType === "personal") {
    if (targetIsPersonal) {
      return source.id;
    }

    const targetSource = getProjectSourceByHost(
      db,
      args.targetProject.id,
      source.hostId,
    );
    if (!targetSource) {
      moveConflict(
        "The destination project has no source configured on this workspace's host.",
      );
    }

    return createManagedWorkspaceEnvironment(
      db,
      hub,
      {
        hostId: source.hostId,
        projectId: args.targetProject.id,
        projectSourcePath: targetSource.path,
        sourceEnvironmentId: source.id,
        threadId: args.threadId,
      },
      onManagedWorkspaceCreated,
    );
  }

  if (targetIsPersonal) {
    moveConflict(
      "A thread with a project workspace cannot move into the personal project.",
    );
  }

  const targetSource =
    source.workspaceProvisionType === "managed-worktree"
      ? getProjectSourceByHost(db, args.targetProject.id, source.hostId)
      : null;
  if (source.workspaceProvisionType === "managed-worktree" && !targetSource) {
    moveConflict(
      "The destination project has no source configured on this workspace's host.",
    );
  }

  // A managed workspace path is a checkout of a specific project source. It
  // cannot be relabeled as another project when the destination points at a
  // different repository; provision a fresh destination checkout instead.
  if (
    source.workspaceProvisionType === "managed-worktree" &&
    targetSource !== null &&
    targetSource.path !== source.path
  ) {
    if (
      args.externalReferenceCount !== 0 ||
      args.inactiveExternalReferenceCount !== 0
    ) {
      moveConflict(
        args.inactiveExternalReferenceCount > 0
          ? "This workspace still belongs to archived or deleted threads. Restore or delete those associations before moving it."
          : "This thread shares a managed workspace with other threads. Move the workspace's threads together instead.",
      );
    }
    return createManagedWorkspaceEnvironment(
      db,
      hub,
      {
        hostId: source.hostId,
        projectId: args.targetProject.id,
        projectSourcePath: targetSource.path,
        sourceEnvironmentId: source.id,
        threadId: args.threadId,
      },
      onManagedWorkspaceCreated,
    );
  }

  const existingTarget = findProjectEnvironmentByHostPath(
    db,
    args.targetProject.id,
    source.hostId,
    source.path,
  );
  const foreignManagedEnvironment = findForeignManagedEnvironmentAtHostPath(
    db,
    {
      excludeEnvironmentId: source.id,
      hostId: source.hostId,
      path: source.path,
      projectId: args.targetProject.id,
    },
  );
  if (foreignManagedEnvironment) {
    moveConflict(
      "The workspace path is already managed by another project and cannot be moved safely.",
    );
  }
  if (existingTarget) {
    if (source.managed && existingTarget.managed) {
      moveConflict(
        "The destination project already has a managed workspace at this path.",
      );
    }
    requireCompatibleTargetEnvironment(existingTarget, source);
    return existingTarget.id;
  }

  if (
    args.externalReferenceCount === 0 &&
    args.inactiveExternalReferenceCount === 0
  ) {
    const transferred = updateEnvironmentProject(
      db,
      hub,
      source.id,
      args.targetProject.id,
    );
    if (!transferred) {
      moveConflict("The workspace changed before the thread could move.");
    }
    return source.id;
  }

  if (source.workspaceProvisionType === "managed-worktree") {
    moveConflict(
      args.inactiveExternalReferenceCount > 0
        ? "This workspace still belongs to archived or deleted threads. Restore or delete those associations before moving it."
        : "This thread shares a managed workspace with other threads. Move the workspace's threads together instead.",
    );
  }

  const created = createEnvironment(db, hub, {
    baseBranch: source.baseBranch,
    branchName: source.branchName,
    defaultBranch: source.defaultBranch,
    hostId: source.hostId,
    isGitRepo: source.isGitRepo,
    isWorktree: source.isWorktree,
    managed: false,
    mergeBaseBranch: source.mergeBaseBranch,
    name: source.name,
    path: source.path,
    projectId: args.targetProject.id,
    status: "ready",
    workspaceProvisionType: "unmanaged",
  });
  return created.id;
}

export function moveThreadToProject(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: MoveThreadToProjectArgs,
): Thread {
  // Lock the root before taking the subtree snapshot. Child creation and
  // reparenting use this same operation domain, so a move either sees the
  // complete hierarchy or rejects a hierarchy that changed after the lock.
  const releaseRootOperation = tryAcquireThreadOperation(args.thread.id);
  if (!releaseRootOperation) {
    moveConflict(
      "This thread has another operation in progress. Wait for it to finish and try again.",
    );
  }

  try {
    const subtree = collectThreadSubtree(deps.db, args.thread);
    const lockedThreadIds = new Set([
      args.thread.id,
      ...subtree.map((thread) => thread.id),
      ...(args.additionalThreadIds ?? []),
      ...(typeof args.metadata.parentThreadId === "string"
        ? [args.metadata.parentThreadId]
        : []),
    ]);
    const releaseOtherOperations = tryAcquireThreadOperations(
      [...lockedThreadIds].filter((threadId) => threadId !== args.thread.id),
    );
    if (!releaseOtherOperations) {
      moveConflict(
        "This thread hierarchy has another operation in progress. Wait for it to finish and try again.",
      );
    }

    try {
      const releaseEnvironmentOperation = tryAcquireEnvironmentOperations(
        subtree.flatMap((thread) =>
          thread.environmentId === null ? [] : [thread.environmentId],
        ),
      );
      if (!releaseEnvironmentOperation) {
        moveConflict(
          "This thread's workspace has another operation in progress. Wait for it to finish and try again.",
        );
      }

      try {
        return moveThreadToProjectWhileLocked(deps, args, lockedThreadIds);
      } finally {
        releaseEnvironmentOperation();
      }
    } finally {
      releaseOtherOperations();
    }
  } finally {
    releaseRootOperation();
  }
}

function moveThreadToProjectWhileLocked(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: MoveThreadToProjectArgs,
  lockedThreadIds: ReadonlySet<string>,
): Thread {
  if (args.thread.projectId === args.targetProject.id) {
    const updated = updateThread(deps.db, deps.hub, args.thread.id, {
      ...args.metadata,
    });
    if (!updated) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }
    return updated;
  }

  if (args.targetProject.id === PERSONAL_PROJECT_ID) {
    moveConflict(
      "A thread with a project workspace cannot move into the personal project.",
    );
  }

  if (args.thread.parentThreadId !== null) {
    moveConflict(
      "Move the parent thread instead of moving a child thread on its own.",
    );
  }
  if (args.thread.status !== "idle" && args.thread.status !== "error") {
    moveConflict("Stop the thread before moving it to another project.");
  }

  const managedWorkspaceProvisionJobs: ManagedWorkspaceProvisionJob[] = [];
  const sourceEnvironmentIdsToClean = new Set<string>();
  const notificationBuffer = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) => {
      const targetProject = getProject(tx, args.targetProject.id);
      if (
        !targetProject ||
        targetProject.kind !== "standard" ||
        targetProject.deletedAt !== null
      ) {
        moveConflict("The destination project is no longer available.");
      }

      const current = getThread(tx, args.thread.id);
      if (
        !current ||
        current.projectId !== args.thread.projectId ||
        (current.status !== "idle" && current.status !== "error") ||
        current.archivedAt !== null ||
        current.deletedAt !== null
      ) {
        throw new ApiError(
          409,
          "invalid_request",
          "Thread changed or is no longer available to move",
        );
      }

      if (current.parentThreadId !== null) {
        moveConflict(
          "Move the parent thread instead of moving a child thread on its own.",
        );
      }
      if (typeof args.metadata.parentThreadId === "string") {
        assertValidParentThread(
          { db: tx },
          {
            childThreadId: current.id,
            parentThreadId: args.metadata.parentThreadId,
            projectId: args.targetProject.id,
          },
        );
      }

      const subtree = collectThreadSubtree(tx, current);
      if (subtree.some((thread) => !lockedThreadIds.has(thread.id))) {
        moveConflict(
          "The thread hierarchy changed before it could move. Try again.",
        );
      }
      for (const child of subtree) {
        if (child.projectId !== current.projectId) {
          moveConflict(
            "This thread hierarchy already spans multiple projects.",
          );
        }
        if (child.status !== "idle" && child.status !== "error") {
          moveConflict(
            "Stop all child threads before moving their parent project.",
          );
        }
      }

      const environmentIds = new Set(
        subtree.flatMap((thread) =>
          thread.environmentId === null ? [] : [thread.environmentId],
        ),
      );
      const environmentTargets = new Map<string, string>();
      for (const environmentId of environmentIds) {
        const source = getEnvironment(tx, environmentId);
        if (!source) {
          moveConflict(
            "This thread references a workspace that no longer exists.",
          );
        }
        const subtreeReferenceCount = subtree.filter(
          (thread) =>
            thread.environmentId === environmentId &&
            thread.archivedAt === null &&
            thread.deletedAt === null,
        ).length;
        const externalReferenceCount =
          countThreadEnvironmentReferences(tx, environmentId) -
          subtreeReferenceCount;
        const subtreeInactiveReferenceCount = subtree.filter(
          (thread) =>
            thread.environmentId === environmentId &&
            (thread.archivedAt !== null || thread.deletedAt !== null),
        ).length;
        const inactiveExternalReferenceCount =
          countInactiveThreadEnvironmentReferences(tx, environmentId) -
          subtreeInactiveReferenceCount;
        environmentTargets.set(
          environmentId,
          resolveTargetEnvironment(
            tx,
            notificationBuffer,
            {
              externalReferenceCount,
              inactiveExternalReferenceCount,
              source,
              threadId: current.id,
              targetProject: args.targetProject,
            },
            (job) => {
              createEnvironmentProvisionRequest(tx, {
                environmentId: job.environmentId,
                requestJson: JSON.stringify(job),
              });
              managedWorkspaceProvisionJobs.push(job);
            },
          ),
        );
        const targetEnvironmentId = environmentTargets.get(environmentId);
        if (targetEnvironmentId !== environmentId) {
          sourceEnvironmentIdsToClean.add(environmentId);
        }
      }

      let updatedRoot: Thread | null = null;
      for (const child of subtree) {
        const nextEnvironmentId =
          child.environmentId === null
            ? null
            : (environmentTargets.get(child.environmentId) ?? null);
        const update: UpdateThreadInput = {
          projectId: args.targetProject.id,
          ...(child.id === current.id ? args.metadata : {}),
          ...(nextEnvironmentId !== child.environmentId
            ? { environmentId: nextEnvironmentId }
            : {}),
        };
        const updated = updateThread(tx, notificationBuffer, child.id, update);
        if (!updated) {
          throw new ApiError(
            409,
            "invalid_request",
            "Thread changed before it could move",
          );
        }
        if (child.id === current.id) {
          updatedRoot = updated;
        }
      }

      if (args.executionOverride) {
        setThreadExecutionOverride(tx, {
          threadId: current.id,
          modelOverride: args.executionOverride.modelOverride,
          reasoningLevelOverride: args.executionOverride.reasoningLevelOverride,
        });
      }

      return updatedRoot;
    },
    { behavior: "immediate" },
  );

  if (!result) {
    throw new ApiError(
      409,
      "invalid_request",
      "Thread changed before it could move",
    );
  }
  notificationBuffer.flushInto(deps.hub);
  for (const environmentId of sourceEnvironmentIdsToClean) {
    if (countLiveThreadsInEnvironment(deps.db, { environmentId }) === 0) {
      requestEnvironmentCleanup(deps, { environmentId });
      void runEnvironmentCleanupAdvance(deps, { environmentId }).catch(
        (error) => {
          deps.logger.warn(
            { err: error, environmentId },
            "Project move environment cleanup advance failed",
          );
        },
      );
    }
  }
  for (const job of managedWorkspaceProvisionJobs) {
    scheduleManagedWorkspaceProvision(deps, job);
  }
  return result;
}

function scheduleManagedWorkspaceProvision(
  deps: LoggedPendingInteractionWorkSessionDeps,
  job: ManagedWorkspaceProvisionJob,
): void {
  deferAfterResponse({
    config: deps.config,
    context: {
      environmentId: job.environmentId,
      threadId: job.threadId,
    },
    logger: deps.logger,
    name: "Personal workspace project move provisioning",
    work: () => runManagedWorkspaceProvision(deps, job),
  });
}

function parseManagedWorkspaceProvisionJob(
  requestJson: string,
): ManagedWorkspaceProvisionJob | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(requestJson);
  } catch {
    return null;
  }
  const result = managedWorkspaceProvisionJobSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

async function runManagedWorkspaceProvision(
  deps: LoggedPendingInteractionWorkSessionDeps,
  job: ManagedWorkspaceProvisionJob,
): Promise<void> {
  let environment = getEnvironment(deps.db, job.environmentId);
  if (!environment || environment.status !== "provisioning") {
    return;
  }

  // A move can be followed by deletion/archive before the deferred callback
  // gets a host session. Do not create an unowned worktree in that case.
  if (
    countLiveThreadsInEnvironment(deps.db, {
      environmentId: environment.id,
    }) === 0
  ) {
    interruptUnrecoverableEnvironmentProvisioning(deps, {
      environmentId: environment.id,
      reason: "Workspace setup was abandoned because its thread was removed.",
    });
    await runEnvironmentCleanupAdvance(deps, {
      environmentId: environment.id,
    });
    return;
  }

  const hostSession = await ensureHostSessionReadyForWork(deps, {
    hostId: job.hostId,
  });
  environment = getEnvironment(deps.db, job.environmentId) ?? environment;
  if (
    environment.status !== "provisioning" ||
    countLiveThreadsInEnvironment(deps.db, {
      environmentId: environment.id,
    }) === 0
  ) {
    if (environment.status === "provisioning") {
      interruptUnrecoverableEnvironmentProvisioning(deps, {
        environmentId: environment.id,
        reason: "Workspace setup was abandoned because its thread was removed.",
      });
      await runEnvironmentCleanupAdvance(deps, {
        environmentId: environment.id,
      });
    }
    return;
  }

  const command = buildEnvironmentProvisionCommand({
    baseBranch: { kind: "default" },
    branchName: job.branchName,
    environmentId: environment.id,
    hostId: job.hostId,
    initiator: {
      provisioningId: job.provisioningId,
      threadId: job.threadId,
    },
    setupTimeoutMs: SETUP_TIMEOUT_MS,
    sourcePath: job.projectSourcePath,
    targetPath: resolveManagedTargetPath({
      dataDir: hostSession.dataDir,
      environmentId: environment.id,
      sourcePath: job.projectSourcePath,
    }),
    workspaceProvisionType: "managed-worktree",
  });
  await advanceEnvironmentProvisioning(deps, {
    environmentId: environment.id,
    request: buildDirectEnvironmentProvisionRequest({
      command,
      provisioningId: job.provisioningId,
    }),
  });
}

/** Resume a move-created workspace from its durable server-owned plan. */
export async function resumeManagedWorkspaceProvisioning(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: { environmentId: string },
): Promise<boolean> {
  const stored = getEnvironmentProvisionRequest(deps.db, args.environmentId);
  if (!stored) {
    return false;
  }

  const job = parseManagedWorkspaceProvisionJob(stored.requestJson);
  if (!job || job.environmentId !== args.environmentId) {
    deps.logger.error(
      { environmentId: args.environmentId },
      "Stored managed workspace provision plan is invalid",
    );
    interruptUnrecoverableEnvironmentProvisioning(deps, {
      environmentId: args.environmentId,
      reason: "Stored workspace setup plan is invalid and cannot be resumed.",
    });
    await runEnvironmentCleanupAdvance(deps, {
      environmentId: args.environmentId,
    });
    return true;
  }

  await runManagedWorkspaceProvision(deps, job);
  return true;
}
