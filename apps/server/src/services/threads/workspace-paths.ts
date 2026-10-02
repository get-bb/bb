import {
  getHostPathSegments,
  isHostPathWithin,
  joinHostPath,
} from "@bb/domain";
import { PLUGIN_PROCESS_DATA_KINDS } from "@bb/process-utils";

const LEGACY_WORKSPACE_ROOT_NAMES = ["worktrees", "personal-workspaces"];

function isInsideDataDirChild(args: {
  dataDir: string;
  name: string;
  path: string;
}): boolean {
  const rootPath = joinHostPath({
    rootPath: args.dataDir,
    relativePath: args.name,
  });
  return (
    rootPath !== null &&
    isHostPathWithin({ rootPath, candidatePath: args.path })
  );
}

export function isBbManagedWorkspacePath(args: {
  dataDir: string;
  path: string;
}): boolean {
  if (
    LEGACY_WORKSPACE_ROOT_NAMES.some((name) =>
      isInsideDataDirChild({ dataDir: args.dataDir, name, path: args.path }),
    )
  ) {
    return true;
  }
  if (
    !isInsideDataDirChild({
      dataDir: args.dataDir,
      name: "plugins",
      path: args.path,
    })
  ) {
    return false;
  }
  const pluginsDepth = (getHostPathSegments(args.dataDir)?.length ?? 0) + 1;
  const [pluginSegment, kind] = (getHostPathSegments(args.path) ?? []).slice(
    pluginsDepth,
  );
  return (
    pluginSegment !== undefined &&
    pluginSegment.length > 0 &&
    kind !== undefined &&
    PLUGIN_PROCESS_DATA_KINDS.some((candidate) => candidate === kind)
  );
}
