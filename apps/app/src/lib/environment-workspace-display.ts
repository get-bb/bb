import type { EnvironmentWorkspaceDisplayKind } from "@bb/domain";
import type { IconName } from "@/components/ui/icon.js";
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

export function getEnvironmentWorkspaceDisplayIconLabel(
  kind: EnvironmentWorkspaceDisplayKind,
): string | null {
  switch (kind) {
    case "managed-worktree":
      return "Managed worktree environment";
    case "unmanaged-worktree":
      return "Git worktree environment";
    case "other":
      return null;
  }
}
