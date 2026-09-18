import { readDefaultBranchRefs } from "bb-environment-provider-host/git";
import type { WorktreeBaseBranch } from "../contract.js";

interface ResolveDefaultWorktreeBaseBranchArgs {
  defaultBranch: string | null;
  originDefaultBranch: string | null;
}

export function resolveDefaultWorktreeBaseBranch(
  args: ResolveDefaultWorktreeBaseBranchArgs,
): string | null {
  return args.originDefaultBranch ?? args.defaultBranch;
}

export async function resolveWorktreeBaseBranch(
  sourcePath: string,
  requested: WorktreeBaseBranch,
): Promise<string | null> {
  if (requested.kind === "named") {
    return requested.name;
  }
  const refs = await readDefaultBranchRefs(sourcePath);
  const resolved = resolveDefaultWorktreeBaseBranch({
    defaultBranch: refs.defaultBranch ?? null,
    originDefaultBranch: refs.originDefaultBranch ?? null,
  });
  return resolved && resolved !== (refs.defaultBranch ?? null)
    ? resolved
    : null;
}
