import {
  readDefaultBranchRefs,
  type DefaultBranchRelation,
} from "bb-environment-provider-host/git";
import type { WorktreeBaseBranch } from "../contract.js";

interface ResolveDefaultWorktreeBaseBranchArgs {
  defaultBranch: string | null;
  defaultBranchRelation: DefaultBranchRelation | null;
  originDefaultBranch: string | null;
}

export function resolveDefaultWorktreeBaseBranch(
  args: ResolveDefaultWorktreeBaseBranchArgs,
): string | null {
  if (!args.originDefaultBranch) {
    return args.defaultBranch;
  }
  if (!args.defaultBranch) {
    return args.originDefaultBranch;
  }
  if (
    args.defaultBranchRelation === "equal" ||
    args.defaultBranchRelation === "local-behind"
  ) {
    return args.originDefaultBranch;
  }
  return args.defaultBranch;
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
    defaultBranchRelation: refs.defaultBranchRelation ?? null,
    originDefaultBranch: refs.originDefaultBranch ?? null,
  });
  return resolved && resolved !== (refs.defaultBranch ?? null)
    ? resolved
    : null;
}
