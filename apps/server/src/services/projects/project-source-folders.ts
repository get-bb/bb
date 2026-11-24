import {
  createProjectSourceFolder,
  isSqliteUniqueConstraintOnColumns,
  listProjectSourceFolders,
  updateProjectSourceFolderPath,
} from "@bb/db";
import {
  areHostPathsEqual,
  canonicalizeHostPath,
  getHostPathDirname,
  isHostPathWithin,
  resolveHostPath,
  type ProjectSource,
  type ProjectSourceFolder,
} from "@bb/domain";
import type {
  ImportProjectSourceFoldersResponse,
  ProjectSourceFolderImportSkipReason,
} from "@bb/server-contract";
import { parseCodeWorkspaceFolders } from "./code-workspace.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import { remapDaemonFileRouteError } from "../hosts/daemon-file-response.js";
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

function importSkipReason(
  error: ApiError,
): ProjectSourceFolderImportSkipReason {
  if (error.body.code === "project_source_folder_conflict") return "duplicate";
  if (error.body.code === "path_not_found") return "not_found";
  if (error.status === 409) return "limit";
  return "invalid";
}

async function readCodeWorkspaceFile(
  deps: WorkSessionDeps,
  args: { hostId: string; path: string },
): Promise<string> {
  const file = await callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.read_file",
      path: args.path,
      followRootSymlink: false,
    },
  }).catch(remapDaemonFileRouteError);
  if ("notModified" in file) {
    throw new Error("Unconditional file read returned not modified");
  }
  return file.contentEncoding === "utf8"
    ? file.content
    : Buffer.from(file.content, "base64").toString("utf8");
}

export async function importCodeWorkspaceFolders(
  deps: WorkSessionDeps,
  args: { path: string; source: ProjectSource },
): Promise<ImportProjectSourceFoldersResponse> {
  const folders = parseCodeWorkspaceFolders(
    await readCodeWorkspaceFile(deps, {
      hostId: args.source.hostId,
      path: args.path,
    }),
  );
  if (folders === null) {
    throw new ApiError(
      400,
      "invalid_request",
      `${args.path} is not a VS Code workspace file`,
    );
  }
  const directory = getHostPathDirname(args.path) ?? args.path;
  const result: ImportProjectSourceFoldersResponse = { added: [], skipped: [] };
  for (const folder of folders) {
    if (folder.kind === "unsupported-uri") {
      result.skipped.push({
        path: folder.uri,
        reason: "unsupported_uri",
        message: `${folder.uri} is not a folder on this machine`,
      });
      continue;
    }
    const resolved = resolveHostPath({
      rootPath: directory,
      path: folder.path,
    });
    if (resolved === null) {
      result.skipped.push({
        path: folder.path,
        reason: "invalid",
        message: `Folder ${folder.path} is not a valid path`,
      });
      continue;
    }
    const path = canonicalizeHostPath(resolved);
    if (areHostPathsEqual(path, args.source.path)) {
      result.skipped.push({
        path,
        reason: "main_folder",
        message: `Folder ${path} is the main folder`,
      });
      continue;
    }
    if (isHostPathWithin({ rootPath: args.source.path, candidatePath: path })) {
      result.skipped.push({
        path,
        reason: "inside_main_folder",
        message: `Folder ${path} is inside the main folder, which threads can already use`,
      });
      continue;
    }
    try {
      result.added.push(
        await addProjectSourceFolder(deps, { path, source: args.source }),
      );
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      result.skipped.push({
        path,
        reason: importSkipReason(error),
        message: error.body.message,
      });
    }
  }
  return result;
}
