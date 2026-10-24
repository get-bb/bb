import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { userExecutableProcessOptions } from "../user-executable-env.js";
import type { WorkspaceGitOperation } from "@bb/domain";
import {
  listBranchOptions,
  refreshRemoteBranches,
} from "bb-environment-provider-host/branch-options";
import {
  detectGitRepoKind,
  readDefaultBranchRefs,
} from "bb-environment-provider-host/workspace-git";
import {
  detectLinkedWorktree,
  getCheckoutRef,
  getWorkspaceGitOperation,
  hasUncommittedChanges,
} from "@bb/host-workspace";

const NO_GIT_OPERATION: WorkspaceGitOperation = { kind: "none" };

export async function listHostBranchOptions(
  command: CommandOf<"host.list_branch_options">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.list_branch_options">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }

  return listBranchOptions({
    ...command,
    ...userExecutableProcessOptions(options?.runtimeManager.getShellEnv() ?? {}),
  });
}

export async function inspectHostGitSource(
  command: CommandOf<"host.inspect_git_source">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.inspect_git_source">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }

  const gitProcessOptions = userExecutableProcessOptions(
    options?.runtimeManager.getShellEnv() ?? {},
  );
  const repoKind = await detectGitRepoKind(command.path, gitProcessOptions);
  if (repoKind === "none") {
    return {
      checkout: { kind: "unknown", reason: "Path is not a git repository" },
      defaultBranch: null,
      defaultBranchRelation: null,
      isWorktree: false,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
    };
  }

  if (command.remoteRefresh === "blocking") {
    await refreshRemoteBranches(command.path, gitProcessOptions, "blocking");
  } else {
    void refreshRemoteBranches(
      command.path,
      gitProcessOptions,
      "background",
    ).catch(() => undefined);
  }

  const [checkout, defaultRefs, dirty, operation, isWorktree] =
    await Promise.all([
      getCheckoutRef(command.path, gitProcessOptions),
      readDefaultBranchRefs(command.path, gitProcessOptions),
      repoKind === "work-tree"
        ? hasUncommittedChanges(command.path, gitProcessOptions)
        : false,
      repoKind === "work-tree"
        ? getWorkspaceGitOperation(command.path, gitProcessOptions)
        : NO_GIT_OPERATION,
      repoKind === "work-tree"
        ? detectLinkedWorktree(command.path, gitProcessOptions)
        : false,
    ]);
  const defaultBranch = defaultRefs.defaultBranch;
  const originDefaultBranch = defaultRefs.originDefaultBranch;
  return {
    checkout,
    defaultBranch: defaultBranch ?? null,
    defaultBranchRelation: defaultRefs.defaultBranchRelation ?? null,
    isWorktree,
    hasUncommittedChanges: dirty,
    operation,
    originDefaultBranch: originDefaultBranch ?? null,
  };
}
