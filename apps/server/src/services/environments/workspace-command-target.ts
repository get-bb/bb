import type { EnvironmentStatus, WorkspaceProvisionType } from "@bb/domain";
import type { WorkspaceContext } from "@bb/host-daemon-contract";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";

interface WorkspaceCommandTargetEnvironment {
  hostId: string;
  id: string;
  path: string | null;
  status: EnvironmentStatus;
  workspaceProvisionType: WorkspaceProvisionType;
}

interface WorkspaceCommandTargetPath {
  path: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

interface WorkspaceCommandTarget {
  environmentId: string;
  hostId: string;
  workspaceContext: WorkspaceContext;
}

export function workspaceContextFromPath(
  target: WorkspaceCommandTargetPath,
): WorkspaceContext {
  return {
    workspacePath: target.path,
    workspaceProvisionType: target.workspaceProvisionType,
  };
}

export function requireWorkspaceCommandTarget(
  environment: WorkspaceCommandTargetEnvironment,
): WorkspaceCommandTarget {
  // Not lifecycle: API boundary validation — workspace commands need a ready
  // workspace and answer with a 4xx otherwise; no transition is written here.
  if (environment.status !== "ready" || !environment.path) {
    throwEnvironmentNotReady(environment);
  }

  return {
    environmentId: environment.id,
    hostId: environment.hostId,
    workspaceContext: workspaceContextFromPath({
      path: environment.path,
      workspaceProvisionType: environment.workspaceProvisionType,
    }),
  };
}
