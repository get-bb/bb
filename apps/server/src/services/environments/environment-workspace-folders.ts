import { listProjectFolderPathsForHost } from "@bb/db";
import type { DbQueryConnection } from "@bb/db";
import {
  mergeWorkspaceFolderPaths,
  type EnvironmentAdditionalPath,
} from "../projects/workspace-folder-paths.js";

export function listEnvironmentExtraFolderPaths(
  db: DbQueryConnection,
  args: {
    additionalPaths: readonly EnvironmentAdditionalPath[];
    hostId: string;
    mainPath: string;
    projectId: string;
  },
): string[] {
  return mergeWorkspaceFolderPaths({
    mainPath: args.mainPath,
    projectFolderPaths: listProjectFolderPathsForHost(db, {
      projectId: args.projectId,
      hostId: args.hostId,
    }),
    additionalPaths: args.additionalPaths,
  });
}
