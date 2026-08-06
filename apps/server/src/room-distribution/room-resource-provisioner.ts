import { isAbsolute, normalize } from "node:path";

import {
  createProject,
  getEnvironment,
  getHost,
  getProject,
  getProjectSourceForProject,
  getThread,
  reserveWorkTogetherRoomResources,
  type ReserveWorkTogetherRoomResourcesInput,
  type WorkTogetherRoomResourceReservation,
} from "@bb/db";
import type { Principal } from "@bb/domain";
import type { AppDeps } from "../types.js";
import { createThreadFromRequest } from "../services/threads/thread-create.js";

export type WorkTogetherRoomResourceTarget = Readonly<{
  bbHostId: string;
  projectName: string;
  providerId: string;
  sourcePath: string;
}>;

export interface WorkTogetherRoomResourceRegistry {
  resolve(input: {
    candidateHostId: string;
    providerRepositoryId: string;
  }): WorkTogetherRoomResourceTarget | null;
}

export type ProvisionWorkTogetherRoomResourcesInput = Readonly<{
  /** Immutable server-resolved identity; never deserialize this from a body. */
  principal: Principal;
  launch: ReserveWorkTogetherRoomResourcesInput;
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

const BB_HOST_ID = /^host_[23456789abcdefghijkmnpqrstuvwxyz]{10}$/u;
const PROVIDER_ID = /^[A-Za-z0-9._-]{1,64}$/u;
const MAX_PROJECT_NAME_CODE_POINTS = 100;
const MAX_SOURCE_PATH_BYTES = 4_096;

function requireTarget(
  target: WorkTogetherRoomResourceTarget | null,
): WorkTogetherRoomResourceTarget {
  if (
    target === null ||
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

function ensureConfiguredHost(
  deps: Pick<AppDeps, "db">,
  target: WorkTogetherRoomResourceTarget,
): void {
  const host = getHost(deps.db, target.bbHostId);
  if (host === null || host.destroyedAt !== null) {
    throw new WorkTogetherRoomProvisioningUnavailableError();
  }
}

function ensureProject(
  deps: Pick<AppDeps, "db" | "hub">,
  reservation: WorkTogetherRoomResourceReservation,
  target: WorkTogetherRoomResourceTarget,
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
  target: WorkTogetherRoomResourceTarget,
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
      environment.workspaceProvisionType !== "managed-worktree" ||
      environment.baseBranch !== reservation.baseBranch ||
      environment.branchName !== reservation.generatedBranch)
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

export function createWorkTogetherRoomResourceProvisioner(
  deps: AppDeps,
  registry: WorkTogetherRoomResourceRegistry,
): WorkTogetherRoomResourceProvisioner {
  return Object.freeze({
    async provision(
      input: ProvisionWorkTogetherRoomResourcesInput,
    ): Promise<ProvisionWorkTogetherRoomResourcesResult> {
      const target = requireTarget(
        registry.resolve({
          candidateHostId: input.launch.candidateHostId,
          providerRepositoryId: input.launch.providerRepositoryId,
        }),
      );
      ensureConfiguredHost(deps, target);
      const reservation = reserveWorkTogetherRoomResources(
        deps.db,
        input.launch,
      );
      ensureProject(deps, reservation, target);
      assertExistingResourceCoherence(deps, reservation, target);

      if (getThread(deps.db, reservation.primaryThreadId) === null) {
        await createThreadFromRequest(
          deps,
          {
            environment: {
              type: "host",
              hostId: target.bbHostId,
              workspace: {
                type: "managed-worktree",
                baseBranch: { kind: "named", name: reservation.baseBranch },
              },
            },
            input: [],
            origin: "app",
            projectId: reservation.projectId,
            providerId: target.providerId,
            startedOnBehalfOf: null,
            title: `Room ${reservation.bindingId.slice(0, 8)}`,
          },
          {
            actor: {
              principalId: input.principal.id,
              principalKind: input.principal.kind,
              displayName: input.principal.displayName,
            },
            resourceReservation: {
              environmentId: reservation.environmentId,
              managedBranchName: reservation.generatedBranch,
              threadId: reservation.primaryThreadId,
            },
          },
        );
      }

      assertExistingResourceCoherence(deps, reservation, target);
      return resultForReservation(deps, reservation);
    },
  });
}
