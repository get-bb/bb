import type { ProjectSourceCheckout } from "@bb/domain";
import type { BaseBranchSpec } from "@bb/server-contract";

interface ResolveDefaultWorktreeBaseBranchArgs {
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
  const defaultWorktreeBaseBranch = resolveDefaultWorktreeBaseBranch(args);
  if (
    defaultWorktreeBaseBranch &&
    defaultWorktreeBaseBranch !== args.defaultBranch
  ) {
    return { kind: "named", name: defaultWorktreeBaseBranch };
  }

  return { kind: "default" };
}

/**
 * Resolve an explicitly named base branch against the checkout the daemon
 * reported. Naming the checkout's default branch (`--base-branch main`) means
 * the same thing as omitting the flag, so it gets the same local-vs-origin
 * policy: base on `origin/<default>` when the local branch is equal or behind,
 * keep the local branch when it is ahead or diverged. The daemon only fetches
 * remote-qualified bases before `git worktree add`, so a plain name that stays
 * local would otherwise seed the worktree from a stale ref without a fetch.
 * Any other plain name is left untouched: the daemon reports no remote
 * relation for it, so bb cannot tell whether its upstream is ahead.
 */
export function resolveManagedNamedBaseBranchSpec(
  spec: Extract<BaseBranchSpec, { kind: "named" }>,
  checkout: ResolveDefaultWorktreeBaseBranchArgs,
): BaseBranchSpec {
  if (spec.name !== checkout.defaultBranch) {
    return spec;
  }
  const resolved = resolveDefaultWorktreeBaseBranch(checkout);
  return resolved && resolved !== spec.name
    ? { kind: "named", name: resolved }
    : spec;
}
