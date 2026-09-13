import { resolveHostEnvironment } from "../hosts/host-environment.js";
import {
  createProjectSource,
  getProjectSourceByHost,
  isSqliteUniqueConstraintOnColumns,
  setProjectGitRemoteUrlIfMissing,
} from "@bb/db";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import { ApiError } from "../../errors.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpcForWork } from "../hosts/online-rpc.js";
import { runLiveHostCommand } from "../hosts/live-command.js";
import { randomUUID } from "node:crypto";

export function projectSourceHostConflict(): ApiError {
  return new ApiError(
    409,
    "project_source_host_conflict",
    "Project already has a source on this host",
  );
}

export function registerProjectSourceOnHost(
  deps: Pick<CommandResultSideEffectsDeps, "db" | "hub">,
  args: {
    projectId: string;
    hostId: string;
    path: string;
    gitRemoteUrl: string | null;
    ownsPath?: boolean;
  },
) {
  let source;
  try {
    source = createProjectSource(deps.db, deps.hub, {
      projectId: args.projectId,
      type: "local_path",
      hostId: args.hostId,
      path: args.path,
      ownsPath: args.ownsPath ?? false,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      isSqliteUniqueConstraintOnColumns(error, {
        columnNames: ["project_id", "host_id"],
        indexName: "project_sources_project_host_idx",
        tableName: "project_sources",
      })
    ) {
      throw projectSourceHostConflict();
    }
    throw error;
  }
  if (args.gitRemoteUrl !== null) {
    setProjectGitRemoteUrlIfMissing(
      deps.db,
      deps.hub,
      args.projectId,
      args.gitRemoteUrl,
    );
  }
  return source;
}

export async function cloneProjectSourceOnHost(
  deps: CommandResultSideEffectsDeps,
  args: {
    projectId: string;
    projectName: string;
    hostId: string;
    remoteUrl: string | null;
    targetPath?: string;
  },
) {
  if (!args.remoteUrl) {
    throw new ApiError(
      400,
      "missing_git_remote",
      "A remoteUrl is required because this project has no git remote anchor",
    );
  }
  const operationId = `project-clone-${randomUUID()}`;
  const resolved = await runLiveHostCommand(deps, {
    hostId: args.hostId,
    timeoutMs: 20 * 60 * 1000,
    command: {
      type: "project.clone",
      operationId,
      contributedEnv: await resolveHostEnvironment(deps, {
        hostId: args.hostId,
        projectId: args.projectId,
      }),
      remoteUrl: args.remoteUrl,
      projectSlug: args.projectName,
      ...(args.targetPath !== undefined ? { targetPath: args.targetPath } : {}),
    },
  });
  return registerProjectSourceOnHost(deps, {
    projectId: args.projectId,
    hostId: args.hostId,
    ...resolved,
    ownsPath: true,
  });
}

interface EnsureProjectSourceArgs {
  projectId: string;
  projectName: string;
  hostId: string;
  remoteUrl: string | null;
}

const pendingSetups = new WeakMap<
  CommandResultSideEffectsDeps["db"],
  Map<
    string,
    {
      hostId: string;
      promise: Promise<ReturnType<typeof registerProjectSourceOnHost>>;
    }
  >
>();

export function hasPendingProjectSourceSetupOnHost(
  db: CommandResultSideEffectsDeps["db"],
  hostId: string,
): boolean {
  const pending = pendingSetups.get(db);
  return (
    pending !== undefined &&
    [...pending.values()].some((setup) => setup.hostId === hostId)
  );
}

export async function ensureProjectSourceOnHost(
  deps: CommandResultSideEffectsDeps,
  args: EnsureProjectSourceArgs,
) {
  let pending = pendingSetups.get(deps.db);
  if (pending === undefined) {
    pending = new Map();
    pendingSetups.set(deps.db, pending);
  }
  const key = JSON.stringify([args.projectId, args.hostId]);
  const active = pending.get(key);
  if (active !== undefined) return active.promise;
  const setup = recoverOrCloneProjectSource(deps, args);
  pending.set(key, { hostId: args.hostId, promise: setup });
  try {
    return await setup;
  } finally {
    if (pending.get(key)?.promise === setup) pending.delete(key);
  }
}

async function recoverOrCloneProjectSource(
  deps: CommandResultSideEffectsDeps,
  args: EnsureProjectSourceArgs,
) {
  const source = getProjectSourceByHost(deps.db, args.projectId, args.hostId);
  if (source !== null) return source;
  if (args.remoteUrl === null) {
    throw new ApiError(
      400,
      "missing_git_remote",
      "This project needs a Git remote to set up its checkout on a new machine",
    );
  }
  const { path } = await callHostRetryableOnlineRpcForWork(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "project.clone_default_path",
      projectSlug: `project-${args.projectId}`,
    },
  });
  const { existence } = await callHostRetryableOnlineRpcForWork(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "host.paths_exist", paths: [path] },
  });
  if (existence[path] === true) {
    const inspected = await callHostRetryableOnlineRpcForWork(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "project.inspect", path },
    });
    if (inspected.path !== path || inspected.gitRemoteUrl !== args.remoteUrl) {
      throw new ApiError(
        409,
        "project_source_target_conflict",
        "The project setup target does not match this project's Git remote",
      );
    }
    return registerProjectSourceOnHost(deps, {
      projectId: args.projectId,
      hostId: args.hostId,
      ...inspected,
    });
  }
  if (existence[path] !== false) {
    throw new ApiError(
      502,
      "invalid_host_response",
      "The machine did not report whether the project setup target exists",
    );
  }
  return cloneProjectSourceOnHost(deps, { ...args, targetPath: path });
}
