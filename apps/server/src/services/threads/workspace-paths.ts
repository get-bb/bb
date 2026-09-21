import path from "node:path";
import { PLUGIN_PROCESS_DATA_KINDS } from "@bb/process-utils";

const LEGACY_WORKSPACE_ROOT_NAMES = ["worktrees", "personal-workspaces"];

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

export function isBbManagedWorkspacePath(args: {
  dataDir: string;
  path: string;
}): boolean {
  if (
    LEGACY_WORKSPACE_ROOT_NAMES.some((name) =>
      isInside(path.posix.join(args.dataDir, name), args.path),
    )
  ) {
    return true;
  }
  const pluginsRoot = path.posix.join(args.dataDir, "plugins");
  if (!args.path.startsWith(`${pluginsRoot}/`)) return false;
  const [pluginSegment, kind] = args.path
    .slice(pluginsRoot.length + 1)
    .split("/");
  return (
    pluginSegment !== undefined &&
    pluginSegment.length > 0 &&
    kind !== undefined &&
    PLUGIN_PROCESS_DATA_KINDS.some((candidate) => candidate === kind)
  );
}
