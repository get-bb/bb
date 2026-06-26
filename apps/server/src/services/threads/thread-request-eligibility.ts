import { getProjectSourceByHost } from "@bb/db";
import {
  type Environment,
  type LocalPathProjectSource,
  PERSONAL_PROJECT_ID,
  type ProjectSource,
} from "@bb/domain";
import type { EnvironmentArgs } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import {
  requireEnvironment,
  requireNonDestroyedHostWithStatus,
} from "../lib/entity-lookup.js";
import {
  assertPrimaryHostId,
  requireConnectedPrimaryHostId,
} from "../hosts/primary-host.js";

type ThreadRequestEnvironment = EnvironmentArgs;
type ThreadRequestEnvironmentDeps = Pick<AppDeps, "config" | "db" | "hub">;
type HostThreadRequestEnvironment = Extract<
  ThreadRequestEnvironment,
  { type: "host" }
>;
type WorkspaceBackedHostWorkspace = Exclude<
  HostThreadRequestEnvironment["workspace"],
  { type: "personal" }
>;
type ReuseThreadRequestEnvironment = Extract<
  ThreadRequestEnvironment,
  { type: "reuse" }
>;
export interface ResolveStableThreadRequestEnvironmentArgs {
  environment: ThreadRequestEnvironment;
  projectId: string;
}

export interface StableThreadRequestProjectData {
  environmentsById: ReadonlyMap<string, Environment>;
  existingHostIds: ReadonlySet<string>;
  primaryHostId: string | null;
  projectId: string;
  projectSources: readonly ProjectSource[];
}

export interface ResolvedHostThreadRequestEnvironment {
  hostId: string;
  localSource: LocalPathProjectSource | null;
  type: "host";
  unmanagedPath: string | null;
  workspace: WorkspaceBackedHostWorkspace;
}

export interface ResolvedReuseThreadRequestEnvironment {
  environment: Environment;
  type: "reuse";
}

export interface ResolvedPersonalThreadRequestEnvironment {
  hostId: string | null;
  type: "personal";
}

export type ResolvedStableThreadRequestEnvironment =
  | ResolvedHostThreadRequestEnvironment
  | ResolvedPersonalThreadRequestEnvironment
  | ResolvedReuseThreadRequestEnvironment;

function requireExistingProjectHost(
  data: StableThreadRequestProjectData,
  hostId: string,
): void {
  if (!data.existingHostIds.has(hostId)) {
    throw new ApiError(404, "host_not_found", "Host not found");
  }
}

function requireProjectDataPrimaryHostId(
  data: StableThreadRequestProjectData,
): string {
  if (data.primaryHostId === null) {
    throw new ApiError(
      502,
      "host_unavailable",
      "Local host daemon is not initialized",
    );
  }
  return data.primaryHostId;
}

function assertProjectDataPrimaryHostId(
  data: StableThreadRequestProjectData,
  hostId: string,
): void {
  const primaryHostId = requireProjectDataPrimaryHostId(data);
  if (hostId !== primaryHostId) {
    throw new ApiError(
      400,
      "unsupported_host",
      "Only the local host daemon is supported",
    );
  }
}

function requireHostEnvironmentId(
  environment: HostThreadRequestEnvironment,
): string {
  if (environment.hostId !== undefined) {
    return environment.hostId;
  }
  throw new ApiError(
    400,
    "invalid_request",
    "hostId is required for workspace-backed thread creation",
  );
}

function assertPersonalWorkspaceProjectCompatibility(projectId: string): void {
  if (projectId !== PERSONAL_PROJECT_ID) {
    throw new ApiError(
      400,
      "invalid_request",
      "Personal workspaces are only supported for the personal project",
    );
  }
}

function assertReuseWorkspaceProjectCompatibility(
  projectId: string,
  environment: Environment,
): void {
  const projectIsPersonal = projectId === PERSONAL_PROJECT_ID;
  const environmentIsPersonal =
    environment.workspaceProvisionType === "personal";
  if (projectIsPersonal && !environmentIsPersonal) {
    throw new ApiError(
      409,
      "invalid_request",
      "Personal project threads must reuse a personal workspace",
    );
  }
  if (!projectIsPersonal && environmentIsPersonal) {
    throw new ApiError(
      409,
      "invalid_request",
      "Standard project threads cannot reuse personal workspaces",
    );
  }
}

function resolveStableHostThreadRequestEnvironmentFromProjectData(
  data: StableThreadRequestProjectData,
  environment: HostThreadRequestEnvironment,
):
  | ResolvedHostThreadRequestEnvironment
  | ResolvedPersonalThreadRequestEnvironment {
  if (environment.workspace.type === "personal") {
    assertPersonalWorkspaceProjectCompatibility(data.projectId);
    const hostId =
      environment.hostId ?? requireProjectDataPrimaryHostId(data);
    assertProjectDataPrimaryHostId(data, hostId);
    requireExistingProjectHost(data, hostId);
    return {
      hostId,
      type: "personal",
    };
  }

  const hostId = requireHostEnvironmentId(environment);
  requireExistingProjectHost(data, hostId);
  assertProjectDataPrimaryHostId(data, hostId);

  if (
    environment.workspace.type === "unmanaged" &&
    environment.workspace.path !== null
  ) {
    return {
      hostId,
      localSource: null,
      type: "host",
      unmanagedPath: environment.workspace.path,
      workspace: environment.workspace,
    };
  }

  const localSource =
    data.projectSources.find(
      (source): source is LocalPathProjectSource =>
        source.type === "local_path" && source.hostId === hostId,
    ) ?? null;
  if (!localSource) {
    throw new ApiError(
      409,
      "invalid_request",
      "No project source configured for this host",
    );
  }

  return {
    hostId,
    localSource,
    type: "host",
    unmanagedPath:
      environment.workspace.type === "unmanaged" ? localSource.path : null,
    workspace: environment.workspace,
  };
}

function resolveStableReuseThreadRequestEnvironmentFromProjectData(
  data: StableThreadRequestProjectData,
  environment: ReuseThreadRequestEnvironment,
): ResolvedReuseThreadRequestEnvironment {
  const reusedEnvironment = data.environmentsById.get(
    environment.environmentId,
  );
  if (!reusedEnvironment) {
    throw new ApiError(404, "environment_not_found", "Environment not found");
  }
  if (reusedEnvironment.projectId !== data.projectId) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment belongs to a different project",
    );
  }
  assertReuseWorkspaceProjectCompatibility(data.projectId, reusedEnvironment);
  assertProjectDataPrimaryHostId(data, reusedEnvironment.hostId);

  return {
    environment: reusedEnvironment,
    type: "reuse",
  };
}

export function resolveStableThreadRequestEnvironmentFromProjectData(
  data: StableThreadRequestProjectData,
  environment: ThreadRequestEnvironment,
): ResolvedStableThreadRequestEnvironment {
  switch (environment.type) {
    case "host":
      return resolveStableHostThreadRequestEnvironmentFromProjectData(
        data,
        environment,
      );
    case "reuse":
      return resolveStableReuseThreadRequestEnvironmentFromProjectData(
        data,
        environment,
      );
    default: {
      const exhaustiveCheck: never = environment;
      throw new Error(
        `Unsupported thread request environment: ${exhaustiveCheck}`,
      );
    }
  }
}

function resolveHostThreadRequestEnvironment(
  deps: ThreadRequestEnvironmentDeps,
  environment: HostThreadRequestEnvironment,
  projectId: string,
):
  | ResolvedHostThreadRequestEnvironment
  | ResolvedPersonalThreadRequestEnvironment {
  if (environment.workspace.type === "personal") {
    assertPersonalWorkspaceProjectCompatibility(projectId);
    const hostId =
      environment.hostId ?? requireConnectedPrimaryHostId(deps);
    assertPrimaryHostId(deps, { hostId });
    requireNonDestroyedHostWithStatus(deps, hostId);
    return {
      hostId,
      type: "personal",
    };
  }

  const hostId = requireHostEnvironmentId(environment);
  requireNonDestroyedHostWithStatus(deps, hostId);
  assertPrimaryHostId(deps, { hostId });

  if (
    environment.workspace.type === "unmanaged" &&
    environment.workspace.path !== null
  ) {
    return {
      hostId,
      localSource: null,
      type: "host",
      unmanagedPath: environment.workspace.path,
      workspace: environment.workspace,
    };
  }

  const localSource = getProjectSourceByHost(deps.db, projectId, hostId);
  if (!localSource || localSource.type !== "local_path") {
    throw new ApiError(
      409,
      "invalid_request",
      "No project source configured for this host",
    );
  }

  return {
    hostId,
    localSource,
    type: "host",
    unmanagedPath:
      environment.workspace.type === "unmanaged" ? localSource.path : null,
    workspace: environment.workspace,
  };
}

function resolveReuseThreadRequestEnvironment(
  deps: ThreadRequestEnvironmentDeps,
  environment: ReuseThreadRequestEnvironment,
  projectId: string,
): ResolvedReuseThreadRequestEnvironment {
  const reusedEnvironment = requireEnvironment(
    deps.db,
    environment.environmentId,
  );
  if (reusedEnvironment.projectId !== projectId) {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment belongs to a different project",
    );
  }
  assertReuseWorkspaceProjectCompatibility(projectId, reusedEnvironment);
  requireNonDestroyedHostWithStatus(deps, reusedEnvironment.hostId);
  assertPrimaryHostId(deps, { hostId: reusedEnvironment.hostId });
  return {
    environment: reusedEnvironment,
    type: "reuse",
  };
}

export function resolveStableThreadRequestEnvironment(
  deps: ThreadRequestEnvironmentDeps,
  args: ResolveStableThreadRequestEnvironmentArgs,
): ResolvedStableThreadRequestEnvironment {
  switch (args.environment.type) {
    case "host":
      return resolveHostThreadRequestEnvironment(
        deps,
        args.environment,
        args.projectId,
      );
    case "reuse":
      return resolveReuseThreadRequestEnvironment(
        deps,
        args.environment,
        args.projectId,
      );
    default: {
      const exhaustiveCheck: never = args.environment;
      throw new Error(
        `Unsupported thread request environment: ${exhaustiveCheck}`,
      );
    }
  }
}
