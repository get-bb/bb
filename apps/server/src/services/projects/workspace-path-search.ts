import {
  DEFAULT_PATH_LIST_EXCLUDE_NAMES,
  WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
} from "../../routes/path-list-policy.js";
import type {
  WorkspacePathSearchFolders,
  WorkspaceSearchPathListResponse,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";

export interface SearchWorkspaceFolderPathsArgs {
  extraFolders: readonly string[];
  folders: WorkspacePathSearchFolders | "all";
  hostId: string;
  includeDirectories: boolean;
  includeFiles: boolean;
  limit: number;
  mainPath: string;
  query: string | undefined;
  signal: AbortSignal;
}

function searchedFolderPaths(args: SearchWorkspaceFolderPathsArgs): string[] {
  if (args.folders === "main") return [args.mainPath];
  if (args.folders === "extra") return [...args.extraFolders];
  return [args.mainPath, ...args.extraFolders];
}

export async function searchWorkspaceFolderPaths(
  deps: WorkSessionDeps,
  args: SearchWorkspaceFolderPathsArgs,
): Promise<WorkspaceSearchPathListResponse> {
  const rootPaths = searchedFolderPaths(args);
  if (rootPaths.length === 0) return { paths: [], truncated: false };
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    signal: args.signal,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.list_paths",
      rootPaths,
      followRootSymlink: true,
      ...(args.query ? { query: args.query } : {}),
      limit: args.limit,
      includeFiles: args.includeFiles,
      includeDirectories: args.includeDirectories,
      includeHidden: WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
      respectGitIgnore: true,
      excludeNames: [...DEFAULT_PATH_LIST_EXCLUDE_NAMES],
    },
  });
  return {
    paths: result.paths.map(({ rootPath, ...entry }) => ({
      ...entry,
      folderPath: rootPath === args.mainPath ? null : rootPath,
    })),
    truncated: result.truncated,
  };
}
