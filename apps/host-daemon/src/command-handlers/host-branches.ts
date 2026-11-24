import path from "node:path";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  CommandDispatchError,
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { userExecutableProcessOptions } from "../user-executable-env.js";
import type { GitSourceInspection, WorkspaceGitOperation } from "@bb/domain";
import {
  emptyBranchOptions,
  readBranchOptions,
  refreshRemoteBranches,
} from "bb-environment-provider-host/branch-options";
import {
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  readCheckoutRef,
  readDefaultBranchRefs,
  readGitRepo,
  type GitProcessOptions,
  type GitRepo,
} from "bb-environment-provider-host/workspace-git";

const NO_GIT_OPERATION: WorkspaceGitOperation = { kind: "none" };

const NON_GIT_SOURCE: GitSourceInspection = {
  checkout: { kind: "unknown", reason: "Path is not a git repository" },
  defaultBranch: null,
  defaultBranchRelation: null,
  defaultWorktreeBaseBranch: null,
  isWorktree: false,
  hasUncommittedChanges: false,
  operation: NO_GIT_OPERATION,
  originDefaultBranch: null,
};

type RemoteRefresh = CommandOf<"host.inspect_git_source">["remoteRefresh"];

function assertAbsolutePath(commandPath: string): void {
  if (!path.isAbsolute(commandPath)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }
}

function gitProcessOptionsFor(
  options: Pick<CommandDispatchOptions, "runtimeManager"> | undefined,
): GitProcessOptions {
  return userExecutableProcessOptions(
    options?.runtimeManager.getShellEnv() ?? {},
  );
}

async function refreshRemote(
  repo: GitRepo,
  gitProcessOptions: GitProcessOptions,
  mode: RemoteRefresh,
): Promise<void> {
  if (mode === "blocking") {
    await refreshRemoteBranches(repo, gitProcessOptions, "blocking");
    return;
  }
  void refreshRemoteBranches(repo, gitProcessOptions, "background").catch(
    () => undefined,
  );
}

async function inspectGitRepo(
  repo: GitRepo,
  gitProcessOptions: GitProcessOptions,
): Promise<GitSourceInspection> {
  const isWorkTree = repo.kind === "work-tree";
  const [checkout, defaultRefs, dirty, operation] = await Promise.all([
    readCheckoutRef(repo, gitProcessOptions),
    readDefaultBranchRefs(repo, gitProcessOptions),
    isWorkTree ? hasUncommittedChanges(repo.path, gitProcessOptions) : false,
    isWorkTree
      ? getWorkspaceGitOperation(repo, gitProcessOptions)
      : NO_GIT_OPERATION,
  ]);
  return {
    checkout,
    defaultBranch: defaultRefs.defaultBranch ?? null,
    defaultBranchRelation: defaultRefs.defaultBranchRelation ?? null,
    defaultWorktreeBaseBranch: defaultRefs.baseBranch?.ref ?? null,
    isWorktree: isWorkTree && repo.isLinkedWorktree,
    hasUncommittedChanges: dirty,
    operation,
    originDefaultBranch: defaultRefs.originDefaultBranch ?? null,
  };
}

export async function listHostBranchOptions(
  command: CommandOf<"host.list_branch_options">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.list_branch_options">> {
  assertAbsolutePath(command.path);

  const gitProcessOptions = gitProcessOptionsFor(options);
  const repo = await readGitRepo(command.path, gitProcessOptions);
  if (repo === null) {
    return {
      ...emptyBranchOptions(command.selectedBranch),
      source: command.includeSource ? NON_GIT_SOURCE : null,
    };
  }

  await refreshRemote(repo, gitProcessOptions, command.remoteRefresh);
  const [branchOptions, source] = await Promise.all([
    readBranchOptions({
      path: command.path,
      limit: command.limit,
      ...(command.query === undefined ? {} : { query: command.query }),
      ...(command.selectedBranch === undefined
        ? {}
        : { selectedBranch: command.selectedBranch }),
      ...gitProcessOptions,
    }),
    command.includeSource ? inspectGitRepo(repo, gitProcessOptions) : null,
  ]);
  return { ...branchOptions, source };
}

export async function inspectHostGitCheckout(
  command: CommandOf<"host.inspect_git_checkout">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.inspect_git_checkout">> {
  assertAbsolutePath(command.path);

  const gitProcessOptions = gitProcessOptionsFor(options);
  const repo = await readGitRepo(command.path, gitProcessOptions);
  if (repo === null) {
    return { checkout: NON_GIT_SOURCE.checkout };
  }
  return { checkout: await readCheckoutRef(repo, gitProcessOptions) };
}

export async function inspectHostGitSource(
  command: CommandOf<"host.inspect_git_source">,
  options?: Pick<CommandDispatchOptions, "runtimeManager">,
): Promise<HostDaemonOnlineRpcResult<"host.inspect_git_source">> {
  assertAbsolutePath(command.path);

  const gitProcessOptions = gitProcessOptionsFor(options);
  const repo = await readGitRepo(command.path, gitProcessOptions);
  if (repo === null) {
    return NON_GIT_SOURCE;
  }

  await refreshRemote(repo, gitProcessOptions, command.remoteRefresh);
  return inspectGitRepo(repo, gitProcessOptions);
}
