import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import {
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";

export async function squashMerge(
  command: CommandOf<"workspace.squash_merge">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.squash_merge">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    requireManagedWorktree: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  const result = await entry.workspace.squashMerge({
    targetBranch: command.targetBranch,
    commitMessage: command.commitMessage,
  });
  return {
    merged: result.merged,
    commitSha: result.commitSha,
    commitSubject: result.commitSubject,
  };
}

export async function pushBranch(
  command: CommandOf<"workspace.push">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.push">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    requireManagedWorktree: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  const result = await entry.workspace.pushBranch({ branch: command.branch });
  return {
    pushedBranch: result.pushedBranch,
    remote: result.remote,
    upstreamSet: result.upstreamSet,
    alreadyUpToDate: result.alreadyUpToDate,
  };
}

export async function createPullRequest(
  command: CommandOf<"workspace.pull_request_create">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.pull_request_create">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    requireManagedWorktree: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  const result = await entry.workspace.createPullRequest({
    base: command.base,
    head: command.head,
    title: command.title,
    body: command.body,
  });
  return {
    provider: result.provider,
    number: result.number,
    url: result.url,
  };
}
