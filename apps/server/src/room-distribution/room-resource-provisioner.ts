import { isAbsolute, normalize } from "node:path";

import {
  createProject,
  getEnvironment,
  getHost,
  getProject,
  getProjectExecutionDefaults,
  getProjectSourceForProject,
  getThread,
  getWorkTogetherRoomResourceReservation,
  reserveWorkTogetherRoomResources,
  workTogetherRoomResourceReservations,
  WorkTogetherRoomResourceReservationConflictError,
  type ReserveWorkTogetherRoomResourcesInput,
  type WorkTogetherRoomResourceReservation,
} from "@bb/db";
import type { Principal } from "@bb/domain";
import { eq } from "drizzle-orm";
import type { AppDeps } from "../types.js";
import { createThreadFromRequest } from "../services/threads/thread-create.js";
import { applyLoggedThreadLifecycleEvent } from "../services/threads/lifecycle-outcome.js";
import { getLastProviderThreadId } from "../services/threads/thread-events.js";
import { getActiveThreadProvisionContext } from "../services/threads/thread-provisioning-active-context.js";
import type { ThreadProvisionEnvironmentIntent } from "../services/threads/thread-provisioning-context.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "../services/threads/thread-provisioning.js";
import { resolveIsolatedScratchTargetPath } from "../services/threads/worktree-paths.js";
import { resolveRequestedProviderId } from "../services/system/requested-provider.js";

export type WorkTogetherRoomHostTarget = Readonly<{
  bbHostId: string;
  dataDir: string;
  providerId: string;
}>;

export type WorkTogetherRoomRepositoryTarget = Readonly<{
  projectName: string;
  sourcePath: string;
}>;

export type WorkTogetherRoomResourceTarget = WorkTogetherRoomHostTarget &
  WorkTogetherRoomRepositoryTarget;

export interface WorkTogetherRoomResourceRegistry {
  resolveHost(input: {
    candidateHostId: string;
  }):
    | WorkTogetherRoomHostTarget
    | null
    | Promise<WorkTogetherRoomHostTarget | null>;
  resolve(input: {
    candidateHostId: string;
    providerRepositoryId: string;
    environmentTemplate?: "managed-worktree" | "detached-read-only";
    objectFormat?: "sha1" | "sha256";
    baseRevision?: string;
  }):
    | WorkTogetherRoomResourceTarget
    | null
    | Promise<WorkTogetherRoomResourceTarget | null>;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;
type LaunchFacts = DistributiveOmit<
  ReserveWorkTogetherRoomResourcesInput,
  "bbHostId" | "projectName" | "providerId" | "sourcePath"
> & {
  /** Optional WT-selected agent backend. Omitted rooms keep the host default. */
  providerId?: string;
  /** Optional WT-selected model for the reserved primary thread. */
  model?: string;
};

export type ProvisionWorkTogetherRoomResourcesInput = Readonly<{
  /** Immutable server-resolved identity; never deserialize this from a body. */
  principal: Principal;
  launch: LaunchFacts;
}>;

export type ProvisionWorkTogetherRoomResourcesResult = Readonly<{
  bindingId: string;
  environmentId: string;
  primaryThreadId: string;
  projectId: string;
  state: "provisioning" | "ready" | "failed";
  failureReason: "bb_environment_failed" | "bb_thread_failed" | null;
}>;

export interface WorkTogetherRoomResourceProvisioner {
  provision(
    input: ProvisionWorkTogetherRoomResourcesInput,
  ): Promise<ProvisionWorkTogetherRoomResourcesResult>;
}

export class WorkTogetherRoomProvisioningConflictError extends Error {
  constructor() {
    super("Work Together Room provisioning conflicts with existing state");
    this.name = "WorkTogetherRoomProvisioningConflictError";
  }
}

export class WorkTogetherRoomProvisioningUnavailableError extends Error {
  constructor() {
    super("Work Together Room provisioning is unavailable");
    this.name = "WorkTogetherRoomProvisioningUnavailableError";
  }
}

export class WorkTogetherRoomRepositoryNotRegisteredError extends Error {
  constructor() {
    super("Work Together Room repository is not registered on the host");
    this.name = "WorkTogetherRoomRepositoryNotRegisteredError";
  }
}

export class WorkTogetherRoomRepositoryRevisionUnavailableError extends Error {
  constructor() {
    super("Work Together Room repository revision is unavailable on the host");
    this.name = "WorkTogetherRoomRepositoryRevisionUnavailableError";
  }
}

const BB_HOST_ID = /^host_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u;
const PROVIDER_ID = /^[A-Za-z0-9._-]{1,64}$/u;
const MAX_PROJECT_NAME_CODE_POINTS = 100;
const MAX_SOURCE_PATH_BYTES = 4_096;

function resolveLaunchProviderId(
  launch: ProvisionWorkTogetherRoomResourcesInput["launch"],
  hostProviderId: string,
): string {
  if (launch.providerId === undefined) {
    return hostProviderId;
  }
  const providerId = resolveRequestedProviderId(launch.providerId);
  if (!PROVIDER_ID.test(providerId)) {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
  return providerId;
}

function requireHostTarget(
  target: WorkTogetherRoomHostTarget | null,
): WorkTogetherRoomHostTarget {
  if (
    target === null ||
    !BB_HOST_ID.test(target.bbHostId) ||
    !PROVIDER_ID.test(target.providerId) ||
    !isAbsolute(target.dataDir) ||
    target.dataDir === "/" ||
    normalize(target.dataDir) !== target.dataDir ||
    target.dataDir !== target.dataDir.trim() ||
    /[\u0000-\u001f\u007f]/u.test(target.dataDir) ||
    Buffer.byteLength(target.dataDir, "utf8") > MAX_SOURCE_PATH_BYTES
  ) {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
  return target;
}

function requireRepositoryTarget(
  target: WorkTogetherRoomResourceTarget | null,
  hostTarget: WorkTogetherRoomHostTarget,
): WorkTogetherRoomResourceTarget {
  if (target === null) {
    throw new WorkTogetherRoomRepositoryNotRegisteredError();
  }
  if (
    target.bbHostId !== hostTarget.bbHostId ||
    target.dataDir !== hostTarget.dataDir ||
    target.providerId !== hostTarget.providerId ||
    target.projectName.length === 0 ||
    target.projectName !== target.projectName.trim() ||
    target.projectName.normalize("NFC") !== target.projectName ||
    /[\u0000-\u001f\u007f]/u.test(target.projectName) ||
    [...target.projectName].length > MAX_PROJECT_NAME_CODE_POINTS ||
    !isAbsolute(target.sourcePath) ||
    target.sourcePath === "/" ||
    normalize(target.sourcePath) !== target.sourcePath ||
    target.sourcePath !== target.sourcePath.trim() ||
    /[\u0000-\u001f\u007f]/u.test(target.sourcePath) ||
    Buffer.byteLength(target.sourcePath, "utf8") > MAX_SOURCE_PATH_BYTES
  ) {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
  return target;
}

function requirePersistedTarget(
  target: Omit<WorkTogetherRoomResourceTarget, "dataDir">,
): Omit<WorkTogetherRoomResourceTarget, "dataDir"> {
  if (
    !BB_HOST_ID.test(target.bbHostId) ||
    !PROVIDER_ID.test(target.providerId) ||
    target.projectName.length === 0 ||
    target.projectName !== target.projectName.trim() ||
    target.projectName.normalize("NFC") !== target.projectName ||
    /[\u0000-\u001f\u007f]/u.test(target.projectName) ||
    [...target.projectName].length > MAX_PROJECT_NAME_CODE_POINTS ||
    !isAbsolute(target.sourcePath) ||
    target.sourcePath === "/" ||
    normalize(target.sourcePath) !== target.sourcePath ||
    target.sourcePath !== target.sourcePath.trim() ||
    /[\u0000-\u001f\u007f]/u.test(target.sourcePath) ||
    Buffer.byteLength(target.sourcePath, "utf8") > MAX_SOURCE_PATH_BYTES
  ) {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
  return target;
}

function persistReservationTarget(
  deps: Pick<AppDeps, "db">,
  reservation: WorkTogetherRoomResourceReservation,
  target: Omit<WorkTogetherRoomResourceTarget, "dataDir">,
): WorkTogetherRoomResourceReservation {
  if (
    reservation.bbHostId === target.bbHostId &&
    reservation.projectName === target.projectName &&
    reservation.providerId === target.providerId &&
    reservation.sourcePath === target.sourcePath
  ) {
    return reservation;
  }
  deps.db
    .update(workTogetherRoomResourceReservations)
    .set({
      bbHostId: target.bbHostId,
      projectName: target.projectName,
      providerId: target.providerId,
      sourcePath: target.sourcePath,
      updatedAt: Date.now(),
    })
    .where(
      eq(workTogetherRoomResourceReservations.bindingId, reservation.bindingId),
    )
    .run();
  return {
    ...reservation,
    bbHostId: target.bbHostId,
    projectName: target.projectName,
    providerId: target.providerId,
    sourcePath: target.sourcePath,
  };
}

function ensureConfiguredHost(
  deps: Pick<AppDeps, "db">,
  target: Pick<WorkTogetherRoomHostTarget, "bbHostId">,
): void {
  const host = getHost(deps.db, target.bbHostId);
  if (host === null || host.destroyedAt !== null) {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
}

function targetFromReservation(
  reservation: WorkTogetherRoomResourceReservation,
): Omit<WorkTogetherRoomResourceTarget, "dataDir"> {
  if (
    reservation.bbHostId === null ||
    reservation.projectName === null ||
    reservation.providerId === null ||
    reservation.sourcePath === null
  ) {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
  return requirePersistedTarget({
    bbHostId: reservation.bbHostId,
    projectName: reservation.projectName,
    providerId: reservation.providerId,
    sourcePath: reservation.sourcePath,
  });
}

function launchMatchesReservation(
  launch: ProvisionWorkTogetherRoomResourcesInput["launch"],
  reservation: WorkTogetherRoomResourceReservation,
): boolean {
  if (
    launch.bindingId !== reservation.bindingId ||
    launch.workspaceId !== reservation.workspaceId ||
    launch.taskId !== reservation.taskId ||
    launch.cellId !== reservation.cellId ||
    launch.candidateHostId !== reservation.candidateHostId ||
    launch.environmentTemplate !== reservation.environmentTemplate ||
    launch.workKind !== reservation.workKind
  ) {
    return false;
  }
  if (
    launch.providerId !== undefined &&
    resolveLaunchProviderId(launch, reservation.providerId ?? "") !==
      reservation.providerId
  ) {
    return false;
  }
  if (launch.environmentTemplate === "isolated-scratch") return true;
  if (
    launch.repositorySnapshotId !== reservation.repositorySnapshotId ||
    launch.repositoryBindingId !== reservation.repositoryBindingId ||
    launch.repositoryBindingVersion !== reservation.repositoryBindingVersion ||
    launch.providerRepositoryId !== reservation.providerRepositoryId ||
    launch.objectFormat !== reservation.objectFormat ||
    launch.baseRevision !== reservation.baseRevision
  ) {
    return false;
  }
  if (launch.environmentTemplate === "detached-read-only") return true;
  return (
    launch.baseBranch === reservation.baseBranch &&
    launch.generatedBranch === reservation.generatedBranch
  );
}

function reservationInputFromLaunch(
  launch: ProvisionWorkTogetherRoomResourcesInput["launch"],
  target: {
    bbHostId: string;
    projectName: string;
    providerId: string;
    sourcePath?: string;
  },
): ReserveWorkTogetherRoomResourcesInput {
  const common = {
    bindingId: launch.bindingId,
    workspaceId: launch.workspaceId,
    taskId: launch.taskId,
    cellId: launch.cellId,
    candidateHostId: launch.candidateHostId,
    workKind: launch.workKind,
    bbHostId: target.bbHostId,
    projectName: target.projectName,
    providerId: target.providerId,
  };
  if (launch.environmentTemplate === "isolated-scratch") {
    return { ...common, environmentTemplate: "isolated-scratch" };
  }
  if (launch.environmentTemplate === "detached-read-only") {
    return {
      ...common,
      workKind: launch.workKind,
      environmentTemplate: "detached-read-only",
      repositorySnapshotId: launch.repositorySnapshotId,
      repositoryBindingId: launch.repositoryBindingId,
      repositoryBindingVersion: launch.repositoryBindingVersion,
      providerRepositoryId: launch.providerRepositoryId,
      objectFormat: launch.objectFormat,
      baseRevision: launch.baseRevision,
      sourcePath: target.sourcePath,
    };
  }
  return {
    ...common,
    workKind: "code",
    environmentTemplate: "managed-worktree",
    repositorySnapshotId: launch.repositorySnapshotId,
    repositoryBindingId: launch.repositoryBindingId,
    repositoryBindingVersion: launch.repositoryBindingVersion,
    providerRepositoryId: launch.providerRepositoryId,
    objectFormat: launch.objectFormat,
    baseRevision: launch.baseRevision,
    baseBranch: launch.baseBranch,
    generatedBranch: launch.generatedBranch,
    sourcePath: target.sourcePath,
  };
}

function ensureProject(
  deps: Pick<AppDeps, "db" | "hub">,
  reservation: WorkTogetherRoomResourceReservation,
  target: Omit<WorkTogetherRoomResourceTarget, "dataDir">,
): void {
  const existing = getProject(deps.db, reservation.projectId);
  if (existing === null) {
    createProject(deps.db, deps.hub, {
      name: target.projectName,
      projectId: reservation.projectId,
      projectSourceId: reservation.projectSourceId,
      source: {
        type: "local_path",
        hostId: target.bbHostId,
        path: target.sourcePath,
      },
    });
    return;
  }

  const source = getProjectSourceForProject(deps.db, {
    projectId: reservation.projectId,
    sourceId: reservation.projectSourceId,
  });
  if (
    existing.deletedAt !== null ||
    existing.name !== target.projectName ||
    source === null ||
    source.type !== "local_path" ||
    source.hostId !== target.bbHostId ||
    source.path !== target.sourcePath
  ) {
    throw new WorkTogetherRoomProvisioningConflictError();
  }
}

function assertExistingResourceCoherence(
  deps: Pick<AppDeps, "db">,
  reservation: WorkTogetherRoomResourceReservation,
  target: Pick<WorkTogetherRoomHostTarget, "bbHostId" | "providerId">,
): void {
  const thread = getThread(deps.db, reservation.primaryThreadId);
  const environment = getEnvironment(deps.db, reservation.environmentId);

  if (
    thread !== null &&
    (thread.projectId !== reservation.projectId ||
      thread.providerId !== target.providerId ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      (thread.environmentId !== null &&
        thread.environmentId !== reservation.environmentId))
  ) {
    throw new WorkTogetherRoomProvisioningConflictError();
  }
  if (
    environment !== null &&
    (environment.projectId !== reservation.projectId ||
      environment.hostId !== target.bbHostId ||
      environment.workspaceProvisionType !== reservation.environmentTemplate ||
      (reservation.environmentTemplate === "managed-worktree" &&
        (environment.baseBranch !== reservation.baseBranch ||
          environment.baseRevision !== reservation.baseRevision ||
          environment.branchName !== reservation.generatedBranch)))
  ) {
    throw new WorkTogetherRoomProvisioningConflictError();
  }
  if (
    environment !== null &&
    thread !== null &&
    thread.environmentId !== reservation.environmentId
  ) {
    throw new WorkTogetherRoomProvisioningConflictError();
  }
}

function resultForReservation(
  deps: Pick<AppDeps, "db">,
  reservation: WorkTogetherRoomResourceReservation,
): ProvisionWorkTogetherRoomResourcesResult {
  const thread = getThread(deps.db, reservation.primaryThreadId);
  const environment = getEnvironment(deps.db, reservation.environmentId);
  let state: ProvisionWorkTogetherRoomResourcesResult["state"] = "provisioning";
  let failureReason: ProvisionWorkTogetherRoomResourcesResult["failureReason"] =
    null;

  if (environment?.provisionFailure === "revision_not_found") {
    throw new WorkTogetherRoomRepositoryRevisionUnavailableError();
  }
  if (environment?.provisionFailure === "unavailable") {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
  if (thread?.status === "error") {
    state = "failed";
    failureReason = "bb_thread_failed";
  } else if (
    environment !== null &&
    environment.status !== "provisioning" &&
    environment.status !== "ready"
  ) {
    state = "failed";
    failureReason = "bb_environment_failed";
  } else if (thread !== null && environment?.status === "ready") {
    state = "ready";
  }

  return Object.freeze({
    bindingId: reservation.bindingId,
    environmentId: reservation.environmentId,
    primaryThreadId: reservation.primaryThreadId,
    projectId: reservation.projectId,
    state,
    failureReason,
  });
}

function isInterruptedRoomProvisioning(
  deps: Pick<AppDeps, "db">,
  threadId: string,
): boolean {
  const thread = getThread(deps.db, threadId);
  if (thread === null || getActiveThreadProvisionContext(thread.id) !== null) {
    return false;
  }
  if (thread.status === "starting") {
    return true;
  }
  // Same pre-start recovery rule as turn dispatch: an errored Room Primary
  // that never received a provider session is a crashed setup, not a terminal
  // run. Exact reservation replay is the caller that resumes it.
  return (
    thread.status === "error" && getLastProviderThreadId(deps, thread.id) === null
  );
}

function recoveryEnvironmentIntent(
  deps: Pick<AppDeps, "db">,
  reservation: WorkTogetherRoomResourceReservation,
  target: Omit<WorkTogetherRoomResourceTarget, "dataDir">,
): ThreadProvisionEnvironmentIntent {
  const environment = getEnvironment(deps.db, reservation.environmentId);
  if (environment?.status === "ready" && environment.path) {
    return {
      type: "reuse",
      environmentId: reservation.environmentId,
    };
  }

  switch (reservation.environmentTemplate) {
    case "isolated-scratch":
      return {
        type: "direct-isolated-scratch",
        environmentId: reservation.environmentId,
        hostId: target.bbHostId,
        workspaceProvisionType: "isolated-scratch",
      };
    case "detached-read-only":
      return {
        type: "direct-detached-read-only",
        environmentId: reservation.environmentId,
        hostId: target.bbHostId,
        sourcePath: target.sourcePath,
        objectFormat: reservation.objectFormat!,
        baseRevision: reservation.baseRevision!,
        workspaceProvisionType: "detached-read-only",
      };
    case "managed-worktree":
      return {
        type: "direct-managed",
        environmentId: reservation.environmentId,
        hostId: target.bbHostId,
        sourcePath: target.sourcePath,
        baseBranch: {
          kind: "named",
          name: reservation.baseBranch!,
        },
        branchName: reservation.generatedBranch!,
        workspaceProvisionType: "managed-worktree",
      };
  }
}

async function resumeInterruptedRoomProvisioning(
  deps: AppDeps,
  args: {
    principal: Principal;
    reservation: WorkTogetherRoomResourceReservation;
    target: Omit<WorkTogetherRoomResourceTarget, "dataDir">;
  },
): Promise<void> {
  if (!isInterruptedRoomProvisioning(deps, args.reservation.primaryThreadId)) {
    return;
  }
  let thread = getThread(deps.db, args.reservation.primaryThreadId);
  if (thread === null) {
    return;
  }

  if (thread.status === "error") {
    const outcome = applyLoggedThreadLifecycleEvent(deps, {
      threadId: thread.id,
      event: { type: "run.preparing" },
    });
    if (!outcome.applied) {
      return;
    }
    thread = getThread(deps.db, thread.id) ?? thread;
  }
  if (thread.status !== "starting") {
    return;
  }

  const defaults = getProjectExecutionDefaults(deps.db, {
    projectId: args.reservation.projectId,
  });
  if (defaults === null || defaults.providerId !== thread.providerId) {
    throw new WorkTogetherRoomProvisioningConflictError();
  }

  const context = requestThreadProvision(deps, {
    actor: {
      principalId: args.principal.id,
      principalKind: args.principal.kind,
      displayName: args.principal.displayName,
    },
    environmentIntent: recoveryEnvironmentIntent(
      deps,
      args.reservation,
      args.target,
    ),
    execution: {
      model: defaults.model,
      serviceTier: defaults.serviceTier,
      reasoningLevel: defaults.reasoningLevel,
      permissionMode: defaults.permissionMode,
      source: "client/thread/start",
    },
    fork: null,
    input: [],
    startedOnBehalfOf: null,
    thread,
    titleProvided: true,
  });
  await advanceThreadProvisioning(deps, {
    context,
    threadId: thread.id,
  });
}

export function createWorkTogetherRoomResourceProvisioner(
  deps: AppDeps,
  registry: WorkTogetherRoomResourceRegistry,
): WorkTogetherRoomResourceProvisioner {
  return Object.freeze({
    async provision(
      input: ProvisionWorkTogetherRoomResourcesInput,
    ): Promise<ProvisionWorkTogetherRoomResourcesResult> {
      const existing = getWorkTogetherRoomResourceReservation(
        deps.db,
        input.launch.bindingId,
      );
      let reservation: WorkTogetherRoomResourceReservation;
      let target: Omit<WorkTogetherRoomResourceTarget, "dataDir">;
      if (existing !== null) {
        if (!launchMatchesReservation(input.launch, existing)) {
          throw new WorkTogetherRoomProvisioningConflictError();
        }
        reservation = existing;
        target = targetFromReservation(existing);
      } else {
        const hostTarget = requireHostTarget(
          await Promise.resolve(
            registry.resolveHost({
              candidateHostId: input.launch.candidateHostId,
            }),
          ),
        );
        const providerId = resolveLaunchProviderId(
          input.launch,
          hostTarget.providerId,
        );
        ensureConfiguredHost(deps, hostTarget);
        const repositoryTarget =
          input.launch.environmentTemplate === "isolated-scratch"
            ? null
            : requireRepositoryTarget(
                await Promise.resolve(
                  registry.resolve({
                    candidateHostId: input.launch.candidateHostId,
                    providerRepositoryId: input.launch.providerRepositoryId,
                    environmentTemplate: input.launch.environmentTemplate,
                    objectFormat: input.launch.objectFormat,
                    baseRevision: input.launch.baseRevision,
                  }),
                ),
                hostTarget,
              );
        const projectName =
          input.launch.environmentTemplate === "isolated-scratch"
            ? `Room ${input.launch.bindingId.slice(0, 8)}`
            : repositoryTarget!.projectName;
        try {
          reservation = reserveWorkTogetherRoomResources(
            deps.db,
            reservationInputFromLaunch(input.launch, {
              bbHostId: hostTarget.bbHostId,
              projectName,
              providerId,
              ...(repositoryTarget !== null
                ? { sourcePath: repositoryTarget.sourcePath }
                : {}),
            }),
          );
        } catch (error) {
          if (
            error instanceof WorkTogetherRoomResourceReservationConflictError
          ) {
            throw new WorkTogetherRoomProvisioningConflictError();
          }
          throw error;
        }
        const sourcePath =
          reservation.environmentTemplate === "isolated-scratch"
            ? resolveIsolatedScratchTargetPath({
                dataDir: hostTarget.dataDir,
                environmentId: reservation.environmentId,
              })
            : repositoryTarget!.sourcePath;
        target = {
          bbHostId: hostTarget.bbHostId,
          projectName,
          providerId,
          sourcePath,
        };
        reservation = persistReservationTarget(deps, reservation, target);
      }
      ensureConfiguredHost(deps, target);
      ensureProject(deps, reservation, target);
      assertExistingResourceCoherence(deps, reservation, target);

      if (getThread(deps.db, reservation.primaryThreadId) === null) {
        const resourceReservation =
          reservation.environmentTemplate === "isolated-scratch"
            ? {
                environmentId: reservation.environmentId,
                environmentTemplate: "isolated-scratch" as const,
                threadId: reservation.primaryThreadId,
              }
            : reservation.environmentTemplate === "detached-read-only"
              ? {
                  environmentId: reservation.environmentId,
                  environmentTemplate: "detached-read-only" as const,
                  objectFormat: reservation.objectFormat!,
                  baseRevision: reservation.baseRevision!,
                  threadId: reservation.primaryThreadId,
                }
              : {
                  environmentId: reservation.environmentId,
                  environmentTemplate: "managed-worktree" as const,
                  managedBranchName: reservation.generatedBranch!,
                  baseRevision: reservation.baseRevision!,
                  providerRepositoryId: reservation.providerRepositoryId!,
                  threadId: reservation.primaryThreadId,
                };
        await createThreadFromRequest(
          deps,
          {
            environment: {
              type: "host",
              hostId: target.bbHostId,
              workspace:
                reservation.environmentTemplate === "isolated-scratch"
                  ? { type: "isolated-scratch" }
                  : reservation.environmentTemplate === "detached-read-only"
                    ? { type: "detached-read-only" }
                    : {
                        type: "managed-worktree",
                        baseBranch: {
                          kind: "named",
                          name: reservation.baseBranch!,
                        },
                      },
            },
            input: [],
            origin: "app",
            projectId: reservation.projectId,
            providerId: target.providerId,
            ...(input.launch.model !== undefined
              ? { model: input.launch.model }
              : {}),
            startedOnBehalfOf: null,
            title: `Room ${reservation.bindingId.slice(0, 8)}`,
          },
          {
            actor: {
              principalId: input.principal.id,
              principalKind: input.principal.kind,
              displayName: input.principal.displayName,
            },
            resourceReservation,
          },
        );
      }

      await resumeInterruptedRoomProvisioning(deps, {
        principal: input.principal,
        reservation,
        target,
      });
      assertExistingResourceCoherence(deps, reservation, target);
      return resultForReservation(deps, reservation);
    },
  });
}
