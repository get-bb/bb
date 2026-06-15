import type { WorkspaceProvisionType } from "@bb/domain";
import type { WorkspaceContext } from "@bb/host-daemon-contract";
import type { ProvisionWorkspaceArgs } from "@bb/host-workspace";

interface ReconnectProvisionArgs {
  environmentId: string;
  personalWorkspaceRoot?: string;
  workspacePath: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

interface WorkspaceContextProvisionArgs {
  environmentId: string;
  personalWorkspaceRoot?: string;
  workspaceContext: WorkspaceContext;
}

export function reconnectProvisionArgs(
  args: ReconnectProvisionArgs,
): ProvisionWorkspaceArgs {
  switch (args.workspaceProvisionType) {
    case "unmanaged":
      return {
        workspaceProvisionType: "unmanaged",
        path: args.workspacePath,
      };
    case "managed-worktree":
      return {
        workspaceProvisionType: "reconnect-managed-worktree",
        path: args.workspacePath,
      };
    case "personal":
      if (!args.personalWorkspaceRoot) {
        throw new Error(
          "Personal workspace root is required to reconnect a personal workspace",
        );
      }
      return {
        workspaceProvisionType: "personal",
        environmentId: args.environmentId,
        personalWorkspaceRoot: args.personalWorkspaceRoot,
        targetPath: args.workspacePath,
      };
  }
}

export function reconnectProvisionArgsFromWorkspaceContext(
  args: WorkspaceContextProvisionArgs,
): ProvisionWorkspaceArgs {
  return reconnectProvisionArgs({
    environmentId: args.environmentId,
    ...(args.personalWorkspaceRoot !== undefined
      ? { personalWorkspaceRoot: args.personalWorkspaceRoot }
      : {}),
    workspacePath: args.workspaceContext.workspacePath,
    workspaceProvisionType: args.workspaceContext.workspaceProvisionType,
  });
}
