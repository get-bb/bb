import {
  ensureGitRepo,
  readDefaultBranchRefs,
  resolveBranchRef,
  type ResolvedBranchRef,
} from "bb-environment-provider-host/git";
import type { WorktreeBaseBranch } from "../contract.js";

export interface ResolvedWorktreeBaseBranch {
  ref: string;
  fetchFailureFallback: boolean;
}

function worktreeBaseBranch(
  resolved: ResolvedBranchRef | undefined,
): ResolvedWorktreeBaseBranch | null {
  if (resolved === undefined) return null;
  return {
    ref: resolved.ref,
    fetchFailureFallback: resolved.source === "origin",
  };
}

export async function resolveWorktreeBaseBranch(
  sourcePath: string,
  requested: WorktreeBaseBranch,
): Promise<ResolvedWorktreeBaseBranch | null> {
  const repo = await ensureGitRepo(sourcePath);
  if (requested.kind === "named") {
    return worktreeBaseBranch(await resolveBranchRef(repo.path, requested.name));
  }
  return worktreeBaseBranch((await readDefaultBranchRefs(repo)).baseBranch);
}
