import {
  createProjectSourceFolder,
  isSqliteUniqueConstraintOnColumns,
  listProjectSourceFolders,
  updateProjectSourceFolderPath,
} from "@bb/db";
import {
  canonicalizeHostPath,
  getHostPathDirname,
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
  type WorkspaceFolderPathProblem,
} from "./workspace-folder-paths.js";

type FolderProblem =
  | WorkspaceFolderPathProblem
  | { kind: "limit" | "not_found"; message: string };

function duplicateFolderProblem(path: string): FolderProblem {
  return { kind: "duplicate", message: `Folder ${path} is already listed` };
}

function folderProblemError(problem: FolderProblem): ApiError {
  switch (problem.kind) {
    case "duplicate":
      return new ApiError(
        409,
        "project_source_folder_conflict",
        problem.message,
      );
    case "limit":
      return new ApiError(409, "invalid_request", problem.message);
    case "not_found":
      return new ApiError(400, "path_not_found", problem.message);
    case "relative":
    case "main_folder":
    case "inside_main_folder":
    case "contains_main_folder":
      return new ApiError(400, "invalid_request", problem.message);
  }
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

async function folderProblem(
  deps: WorkSessionDeps,
  args: {
    atLimit: boolean;
    existingPaths: readonly string[];
    path: string;
    source: ProjectSource;
  },
): Promise<FolderProblem | null> {
  const pathProblem = workspaceFolderPathProblem({
    existingPaths: args.existingPaths,
    mainPath: args.source.path,
    path: args.path,
  });
  if (pathProblem !== null) return pathProblem;
  if (args.atLimit) {
    return {
      kind: "limit",
      message: `A project checkout can have at most ${MAX_WORKSPACE_FOLDERS} folders`,
    };
  }
  const { existence } = await callHostRetryableOnlineRpc(deps, {
    hostId: args.source.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "host.paths_exist", paths: [args.path] },
  });
  if (existence[args.path] !== true) {
    return {
      kind: "not_found",
      message: `Folder ${args.path} does not exist on this machine`,
    };
  }
  return null;
}

async function tryAddProjectSourceFolder(
  deps: WorkSessionDeps,
  args: { path: string; source: ProjectSource },
): Promise<{ folder: ProjectSourceFolder } | { problem: FolderProblem }> {
  const existing = listProjectSourceFolders(deps.db, args.source.id);
  const problem = await folderProblem(deps, {
    atLimit: existing.length >= MAX_WORKSPACE_FOLDERS,
    existingPaths: existing.map((folder) => folder.path),
    path: args.path,
    source: args.source,
  });
  if (problem !== null) return { problem };
  try {
    return {
      folder: createProjectSourceFolder(deps.db, deps.hub, {
        projectId: args.source.projectId,
        projectSourceId: args.source.id,
        path: args.path,
      }),
    };
  } catch (error) {
    if (isDuplicateFolderError(error)) {
      return { problem: duplicateFolderProblem(args.path) };
    }
    throw error;
  }
}

export async function addProjectSourceFolder(
  deps: WorkSessionDeps,
  args: { path: string; source: ProjectSource },
): Promise<ProjectSourceFolder> {
  const result = await tryAddProjectSourceFolder(deps, args);
  if ("problem" in result) throw folderProblemError(result.problem);
  return result.folder;
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
  const problem = await folderProblem(deps, {
    atLimit: false,
    existingPaths: existing
      .filter((folder) => folder.id !== args.folderId)
      .map((folder) => folder.path),
    path: args.path,
    source: args.source,
  });
  if (problem !== null) throw folderProblemError(problem);
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
      throw folderProblemError(duplicateFolderProblem(args.path));
    }
    throw error;
  }
}

function importSkipReason(
  kind: FolderProblem["kind"],
): ProjectSourceFolderImportSkipReason {
  switch (kind) {
    case "main_folder":
    case "inside_main_folder":
    case "duplicate":
    case "not_found":
    case "limit":
      return kind;
    case "relative":
    case "contains_main_folder":
      return "invalid";
  }
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
    if (folder.kind === "invalid") {
      result.skipped.push({
        path: folder.entry,
        reason: "invalid",
        message: `${folder.entry} has no folder path or uri`,
      });
      continue;
    }
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
    const added = await tryAddProjectSourceFolder(deps, {
      path,
      source: args.source,
    });
    if ("folder" in added) {
      result.added.push(added.folder);
    } else {
      result.skipped.push({
        path,
        reason: importSkipReason(added.problem.kind),
        message: added.problem.message,
      });
    }
  }
  return result;
}
