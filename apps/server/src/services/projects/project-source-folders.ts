import {
  createProjectSourceFolder,
  isSqliteUniqueConstraintOnColumns,
  listProjectSourceFolders,
  updateProjectSourceFolderPath,
} from "@bb/db";
import type { ProjectSource, ProjectSourceFolder } from "@bb/domain";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  MAX_WORKSPACE_FOLDERS,
  workspaceFolderPathProblem,
} from "./workspace-folder-paths.js";

function duplicateFolder(path: string): ApiError {
  return new ApiError(
    409,
    "project_source_folder_conflict",
    `Folder ${path} is already listed`,
  );
}

function isDuplicateFolderError(error: unknown): boolean {
  return (
    error instanceof Error &&
    isSqliteUniqueConstraintOnColumns(error, {
      columnNames: ["project_source_id", "path"],
      indexName: "project_source_folders_source_path_idx",
      tableName: "project_source_folders",
    })
  );
}

async function assertUsableFolderPath(
  deps: WorkSessionDeps,
  args: {
    existingPaths: readonly string[];
    path: string;
    source: ProjectSource;
  },
): Promise<void> {
  const problem = workspaceFolderPathProblem({
    existingPaths: args.existingPaths,
    mainPath: args.source.path,
    path: args.path,
  });
  if (problem?.kind === "duplicate") {
    throw duplicateFolder(args.path);
  }
  if (problem !== null) {
    throw new ApiError(400, "invalid_request", problem.message);
  }
  const { existence } = await callHostRetryableOnlineRpc(deps, {
    hostId: args.source.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "host.paths_exist", paths: [args.path] },
  });
  if (existence[args.path] !== true) {
    throw new ApiError(
      400,
      "path_not_found",
      `Folder ${args.path} does not exist on this machine`,
    );
  }
}

export async function addProjectSourceFolder(
  deps: WorkSessionDeps,
  args: { path: string; source: ProjectSource },
): Promise<ProjectSourceFolder> {
  const existing = listProjectSourceFolders(deps.db, args.source.id);
  if (existing.length >= MAX_WORKSPACE_FOLDERS) {
    throw new ApiError(
      409,
      "invalid_request",
      `A project checkout can have at most ${MAX_WORKSPACE_FOLDERS} folders`,
    );
  }
  await assertUsableFolderPath(deps, {
    existingPaths: existing.map((folder) => folder.path),
    path: args.path,
    source: args.source,
  });
  try {
    return createProjectSourceFolder(deps.db, deps.hub, {
      projectId: args.source.projectId,
      projectSourceId: args.source.id,
      path: args.path,
    });
  } catch (error) {
    if (isDuplicateFolderError(error)) {
      throw duplicateFolder(args.path);
    }
    throw error;
  }
}

export async function updateProjectSourceFolder(
  deps: WorkSessionDeps,
  args: { folderId: string; path: string; source: ProjectSource },
): Promise<ProjectSourceFolder> {
  const existing = listProjectSourceFolders(deps.db, args.source.id);
  const current = existing.find((folder) => folder.id === args.folderId);
  if (current === undefined) {
    throw new ApiError(404, "invalid_request", "Project source folder not found");
  }
  if (current.path === args.path) {
    return current;
  }
  await assertUsableFolderPath(deps, {
    existingPaths: existing
      .filter((folder) => folder.id !== args.folderId)
      .map((folder) => folder.path),
    path: args.path,
    source: args.source,
  });
  try {
    const updated = updateProjectSourceFolderPath(deps.db, deps.hub, {
      projectId: args.source.projectId,
      projectSourceId: args.source.id,
      folderId: args.folderId,
      path: args.path,
    });
    if (updated === null) {
      throw new ApiError(
        404,
        "invalid_request",
        "Project source folder not found",
      );
    }
    return updated;
  } catch (error) {
    if (isDuplicateFolderError(error)) {
      throw duplicateFolder(args.path);
    }
    throw error;
  }
}
