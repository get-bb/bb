import type { EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import type { IconName } from "@bb/shared-ui/icon";
import { PersistentHostIconName } from "@/lib/host-display";

export function getEnvironmentWorkspaceDisplayIconName(
  kind: EnvironmentWorkspaceDisplayKind,
): IconName | null {
  switch (kind) {
    case "managed-worktree":
      return "FolderGit";
    case "unmanaged-worktree":
      return "FolderGit";
    case "other":
      return null;
  }
}

export function getEnvironmentWorkspaceLabelIconName(
  kind: EnvironmentWorkspaceDisplayKind,
): IconName {
  return getEnvironmentWorkspaceDisplayIconName(kind) ?? PersistentHostIconName;
}
