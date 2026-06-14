import path from "node:path";
import type { GitBranchRefClassification } from "@bb/domain";
import {
  detectGitRepo,
  getCheckoutRef,
  getWorkspaceGitOperation,
  hasUncommittedChanges,
  listBranches,
  listRemoteBranches,
  readDefaultBranch,
} from "@bb/host-workspace";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import { CommandDispatchError } from "../command-dispatch-support.js";
import type { CommandOf } from "../command-dispatch-support.js";

interface LimitBranchListArgs {
  branches: readonly string[];
  limit: number;
  query?: string;
}

interface LimitedBranchList {
  branches: string[];
  truncated: boolean;
}

interface PinBranchArgs {
  branches: readonly string[];
  branch: string | null | undefined;
}

interface ClassifySelectedBranchArgs {
  branches: readonly string[];
  remoteBranches: readonly string[];
  selectedBranch?: string;
}

function limitBranchList({
  branches,
  limit,
  query,
}: LimitBranchListArgs): LimitedBranchList {
  const normalizedQuery = query?.trim().toLowerCase();
  const filteredBranches =
    normalizedQuery && normalizedQuery.length > 0
      ? branches.filter((branch) =>
          branch.toLowerCase().includes(normalizedQuery),
        )
      : [...branches];
  return {
    branches: filteredBranches.slice(0, limit),
    truncated: filteredBranches.length > limit,
  };
}

function pinBranch({ branches, branch }: PinBranchArgs): string[] {
  if (!branch || !branches.includes(branch)) {
    return [...branches];
  }

  return [branch, ...branches.filter((candidate) => candidate !== branch)];
}

function classifySelectedBranch({
  branches,
  remoteBranches,
  selectedBranch,
}: ClassifySelectedBranchArgs): GitBranchRefClassification | null {
  if (!selectedBranch) {
    return null;
  }

  if (branches.includes(selectedBranch)) {
    return { name: selectedBranch, kind: "local" };
  }

  if (remoteBranches.includes(selectedBranch)) {
    return { name: selectedBranch, kind: "remote" };
  }

  return { name: selectedBranch, kind: "missing" };
}

export async function listHostBranches(
  command: CommandOf<"host.list_branches">,
): Promise<HostDaemonOnlineRpcResult<"host.list_branches">> {
  if (!path.isAbsolute(command.path)) {
    throw new CommandDispatchError("invalid_path", "Path must be absolute");
  }

  if (!(await detectGitRepo(command.path))) {
    return {
      branches: [],
      branchesTruncated: false,
      checkout: { kind: "unknown", reason: "Path is not a git repository" },
      defaultBranch: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: classifySelectedBranch({
        branches: [],
        remoteBranches: [],
        selectedBranch: command.selectedBranch,
      }),
    };
  }

  const [branches, remoteBranches, checkout, defaultBranch, dirty, operation] =
    await Promise.all([
      listBranches(command.path),
      listRemoteBranches(command.path),
      getCheckoutRef(command.path),
      readDefaultBranch(command.path),
      hasUncommittedChanges(command.path),
      getWorkspaceGitOperation(command.path),
    ]);
  // Pin default refs to the first page so common picks like main and
  // origin/main are available before the user searches.
  const sorted = pinBranch({ branches, branch: defaultBranch });
  const sortedRemoteBranches = pinBranch({
    branches: remoteBranches,
    branch: defaultBranch ? `origin/${defaultBranch}` : null,
  });
  const limitedBranches = limitBranchList({
    branches: sorted,
    limit: command.limit,
    query: command.query,
  });
  const limitedRemoteBranches = limitBranchList({
    branches: sortedRemoteBranches,
    limit: command.limit,
    query: command.query,
  });
  const selectedBranch = classifySelectedBranch({
    branches,
    remoteBranches,
    selectedBranch: command.selectedBranch,
  });
  return {
    branches: limitedBranches.branches,
    branchesTruncated: limitedBranches.truncated,
    checkout,
    defaultBranch: defaultBranch ?? null,
    hasUncommittedChanges: dirty,
    operation,
    remoteBranches: limitedRemoteBranches.branches,
    remoteBranchesTruncated: limitedRemoteBranches.truncated,
    selectedBranch,
  };
}
