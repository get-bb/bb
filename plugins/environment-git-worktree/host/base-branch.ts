import { selectWorktreeBaseBranch } from "bb-environment-provider-host/base-branch";
import {
  readDefaultBranchRefs,
  hasRef,
  readBranchRelation,
} from "bb-environment-provider-host/git";
import type { WorktreeBaseBranch } from "../contract.js";

export async function resolveWorktreeBaseBranch(
  sourcePath: string,
  requested: WorktreeBaseBranch,
): Promise<string | null> {
  if (requested.kind === "named") {
    if (
      requested.name.startsWith("refs/") ||
      (await hasRef(sourcePath, `refs/remotes/${requested.name}`))
    )
      return requested.name;
    const [hasLocalBranch, hasRemoteBranch] = await Promise.all([
      hasRef(sourcePath, `refs/heads/${requested.name}`),
      hasRef(sourcePath, `refs/remotes/origin/${requested.name}`),
    ]);
    if (!hasRemoteBranch) return requested.name;
    const localBranch = hasLocalBranch ? requested.name : null;
    const remoteBranch = `origin/${requested.name}`;
    return selectWorktreeBaseBranch({
      defaultBranch: localBranch,
      originDefaultBranch: remoteBranch,
      defaultBranchRelation:
        (await readBranchRelation(
          sourcePath,
          localBranch ?? undefined,
          remoteBranch,
        )) ?? null,
    });
  }
  const refs = await readDefaultBranchRefs(sourcePath);
  return selectWorktreeBaseBranch({
    defaultBranch: refs.defaultBranch ?? null,
    defaultBranchRelation: refs.defaultBranchRelation ?? null,
    originDefaultBranch: refs.originDefaultBranch ?? null,
  });
}
