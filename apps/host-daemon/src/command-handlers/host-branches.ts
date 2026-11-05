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
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  readCheckoutRef,
  readDefaultBranchRefs,
  readGitRepo,
} from "bb-environment-provider-host/workspace-git";

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

export async function inspectHostGitCheckout(
  command: CommandOf<"host.inspect_git_checkout">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.inspect_git_checkout">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }

  const gitProcessOptions = userExecutableProcessOptions(
    options?.runtimeManager.getShellEnv() ?? {},
  );
  const repo = await readGitRepo(command.path, gitProcessOptions);
  if (repo === null) {
    return {
      checkout: { kind: "unknown", reason: "Path is not a git repository" },
    };
  }
  return { checkout: await readCheckoutRef(repo, gitProcessOptions) };
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
  const repo = await readGitRepo(command.path, gitProcessOptions);
  if (repo === null) {
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
    await refreshRemoteBranches(repo, gitProcessOptions, "blocking");
  } else {
    void refreshRemoteBranches(repo, gitProcessOptions, "background").catch(
      () => undefined,
    );
  }

  const isWorkTree = repo.kind === "work-tree";
  const [checkout, defaultRefs, dirty, operation] = await Promise.all([
    readCheckoutRef(repo, gitProcessOptions),
    readDefaultBranchRefs(repo, gitProcessOptions),
    isWorkTree ? hasUncommittedChanges(repo.path, gitProcessOptions) : false,
    isWorkTree
      ? getWorkspaceGitOperation(repo, gitProcessOptions)
      : NO_GIT_OPERATION,
  ]);
  const defaultBranch = defaultRefs.defaultBranch;
  const originDefaultBranch = defaultRefs.originDefaultBranch;
  return {
    checkout,
    defaultBranch: defaultBranch ?? null,
    defaultBranchRelation: defaultRefs.defaultBranchRelation ?? null,
    isWorktree: isWorkTree && repo.isLinkedWorktree,
    hasUncommittedChanges: dirty,
    operation,
    originDefaultBranch: originDefaultBranch ?? null,
  };
}
