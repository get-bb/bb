import { listProjectFolderPathsForHost } from "@bb/db";
import type { DbQueryConnection } from "@bb/db";
import { mergeWorkspaceFolderPaths } from "../projects/workspace-folder-paths.js";

export function listEnvironmentExtraFolderPaths(
  db: DbQueryConnection,
  args: {
    additionalPaths: readonly string[];
    hostId: string;
    mainPath: string;
    projectId: string;
  },
): string[] {
  return mergeWorkspaceFolderPaths({
    mainPath: args.mainPath,
    paths: [
      ...listProjectFolderPathsForHost(db, {
        projectId: args.projectId,
        hostId: args.hostId,
      }),
      ...args.additionalPaths,
    ],
  });
}
