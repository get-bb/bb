import {
  getEnvironment,
  getWorkTogetherRoomResourceReservationByEnvironment,
} from "@bb/db";
import type { Thread } from "@bb/domain";
import type {
  CreateThreadEnvironmentArgs,
  EnvironmentArgs,
} from "@bb/server-contract";

import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";

interface ResolveWorkTogetherRoomChildEnvironmentArgs {
  parentThread: Pick<Thread, "environmentId" | "projectId"> | null;
  requestedEnvironment: CreateThreadEnvironmentArgs;
}

function isImplicitHostDefault(
  requested: CreateThreadEnvironmentArgs,
  hostId: string,
): boolean {
  return (
    requested.type === "host" &&
    requested.hostId === hostId &&
    requested.workspace.type === "unmanaged" &&
    requested.workspace.path === null
  );
}

function refuseChangedFence(): never {
  throw new ApiError(
    409,
    "invalid_request",
    "Room Subagents must reuse the Room's reserved environment",
  );
}

/**
 * Resolve an implicit Room child onto the Primary's immutable environment.
 * Explicit requests that would select another host, workspace, or environment
 * fail before thread creation and therefore before provider execution.
 */
export function resolveWorkTogetherRoomChildEnvironment(
  deps: Pick<AppDeps, "db">,
  args: ResolveWorkTogetherRoomChildEnvironmentArgs,
): CreateThreadEnvironmentArgs {
  const parentThread = args.parentThread;
  if (parentThread === null || parentThread.environmentId === null) {
    return args.requestedEnvironment;
  }
  const parentEnvironmentId = parentThread.environmentId;

  const reservation = getWorkTogetherRoomResourceReservationByEnvironment(
    deps.db,
    {
      environmentId: parentEnvironmentId,
      projectId: parentThread.projectId,
    },
  );
  if (reservation === null) return args.requestedEnvironment;

  const environment = getEnvironment(deps.db, reservation.environmentId);
  if (
    environment === null ||
    environment.projectId !== reservation.projectId ||
    environment.workspaceProvisionType !== reservation.environmentTemplate ||
    (reservation.environmentTemplate === "managed-worktree" &&
      (environment.baseBranch !== reservation.baseBranch ||
        environment.branchName !== reservation.generatedBranch)) ||
    (reservation.environmentTemplate !== "managed-worktree" &&
      environment.branchName !== null)
  ) {
    refuseChangedFence();
  }

  const exactReuse: EnvironmentArgs = {
    type: "reuse",
    environmentId: reservation.environmentId,
  };
  if (
    args.requestedEnvironment.type === "project-default" ||
    (args.requestedEnvironment.type === "reuse" &&
      args.requestedEnvironment.environmentId === reservation.environmentId) ||
    isImplicitHostDefault(args.requestedEnvironment, environment.hostId)
  ) {
    return exactReuse;
  }

  return refuseChangedFence();
}
