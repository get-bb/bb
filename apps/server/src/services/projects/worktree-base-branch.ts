import type { ProjectSourceCheckout } from "@bb/domain";
import type { BaseBranchSpec } from "@bb/server-contract";

export interface ResolveDefaultWorktreeBaseBranchArgs {
  defaultBranch: ProjectSourceCheckout["defaultBranch"];
  defaultBranchRelation: ProjectSourceCheckout["defaultBranchRelation"];
  originDefaultBranch: ProjectSourceCheckout["originDefaultBranch"];
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

export function resolveManagedDefaultBaseBranchSpec(
  args: ResolveDefaultWorktreeBaseBranchArgs,
): BaseBranchSpec {
  // Managed fresh-default requests deliberately prefer the remote-qualified
  // default even when the local branch is ahead or diverged. Provisioning
  // fetches remote-qualified refs before branching, so this resolves to the
  // current remote tip rather than whichever local commit happened to exist.
  if (args.originDefaultBranch) {
    return { kind: "named", name: args.originDefaultBranch };
  }

  // Repositories without a remote retain the existing local/default fallback.
  return { kind: "default" };
}
