import path from "node:path";
import { PLUGIN_PROCESS_DATA_KINDS } from "@bb/process-utils";

const LEGACY_WORKSPACE_ROOT_NAMES = ["worktrees", "personal-workspaces"];

function isInside(root: string, candidate: string): boolean {
  // bb-fork(windows): compare with native separators via path.relative.
  const relative = path.relative(root, candidate);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function isBbManagedWorkspacePath(args: {
  dataDir: string;
  path: string;
}): boolean {
  if (
    LEGACY_WORKSPACE_ROOT_NAMES.some((name) =>
      isInside(path.join(args.dataDir, name), args.path),
    )
  ) {
    return true;
  }
  const pluginsRoot = path.join(args.dataDir, "plugins");
  const relative = path.relative(pluginsRoot, args.path);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative))
    return false;
  const [pluginSegment, kind] = relative.split(path.sep);
  return (
    pluginSegment !== undefined &&
    pluginSegment.length > 0 &&
    kind !== undefined &&
    PLUGIN_PROCESS_DATA_KINDS.some((candidate) => candidate === kind)
  );
}
