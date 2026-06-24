import { recordEnvironmentCurrentBranch } from "@bb/db/internal-environment-lifecycle";
import type { Environment } from "@bb/domain";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import type { WorkspaceCommandTarget } from "./workspace-command-target.js";

type WorkspaceStatusResult = HostDaemonOnlineRpcResult<"workspace.status">;

interface CallEnvironmentWorkspaceStatusArgs {
  environment: Pick<Environment, "id">;
  target: WorkspaceCommandTarget;
  mergeBaseBranch?: string;
}

function normalizeObservedDefaultBranch(defaultBranch: string): string | null {
  return defaultBranch.length > 0 ? defaultBranch : null;
}

export async function callEnvironmentWorkspaceStatus(
  deps: AppDeps,
  args: CallEnvironmentWorkspaceStatusArgs,
): Promise<WorkspaceStatusResult> {
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: args.target.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "workspace.status",
      environmentId: args.target.environmentId,
      workspaceContext: args.target.workspaceContext,
      ...(args.mergeBaseBranch
        ? { mergeBaseBranch: args.mergeBaseBranch }
        : {}),
    },
  });

  if (result.outcome === "available") {
    recordEnvironmentCurrentBranch(deps.db, deps.hub, args.environment.id, {
      branchName: result.workspaceStatus.branch.currentBranch,
      defaultBranch: normalizeObservedDefaultBranch(
        result.workspaceStatus.branch.defaultBranch,
      ),
    });
  }

  return result;
}
