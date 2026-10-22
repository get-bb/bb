import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  COMMAND_TIMEOUT_MS,
  WORKSPACE_STATUS_MAX_FILES,
  WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_BYTES,
  WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_FILES,
} from "../../constants.js";
import type { AppDeps } from "../../types.js";
import {
  callHostRetryableOnlineRpc,
  callHostRetryableOnlineRpcForWork,
} from "../hosts/online-rpc.js";
import type { WorkspaceCommandTarget } from "./workspace-command-target.js";

type WorkspaceStatusResult = HostDaemonOnlineRpcResult<"workspace.status">;

interface CallEnvironmentWorkspaceStatusArgs {
  target: WorkspaceCommandTarget;
  mergeBaseBranch?: string;
}

export async function callEnvironmentWorkspaceStatus(
  deps: AppDeps,
  args: CallEnvironmentWorkspaceStatusArgs,
): Promise<WorkspaceStatusResult> {
  return callEnvironmentWorkspaceStatusWith(
    deps,
    args,
    callHostRetryableOnlineRpc,
  );
}

export async function callEnvironmentWorkspaceStatusForWork(
  deps: AppDeps,
  args: CallEnvironmentWorkspaceStatusArgs,
): Promise<WorkspaceStatusResult> {
  return callEnvironmentWorkspaceStatusWith(
    deps,
    args,
    callHostRetryableOnlineRpcForWork,
  );
}

function callEnvironmentWorkspaceStatusWith(
  deps: AppDeps,
  args: CallEnvironmentWorkspaceStatusArgs,
  callRpc: typeof callHostRetryableOnlineRpc,
): Promise<WorkspaceStatusResult> {
  return callRpc(deps, {
    hostId: args.target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.status",
      environmentId: args.target.environmentId,
      workspaceContext: args.target.workspaceContext,
      maxFiles: WORKSPACE_STATUS_MAX_FILES,
      maxUntrackedLineStatFiles: WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_FILES,
      maxUntrackedLineStatBytes: WORKSPACE_STATUS_MAX_UNTRACKED_LINE_STAT_BYTES,
      ...(args.mergeBaseBranch
        ? { mergeBaseBranch: args.mergeBaseBranch }
        : {}),
    },
  });
}
