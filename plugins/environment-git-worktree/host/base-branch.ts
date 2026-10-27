import {
  hasRef,
  readBranchRelation,
  readDefaultBranchRefs,
} from "bb-environment-provider-host/git";
import type {
  DefaultBranchRelation,
} from "bb-environment-provider-host/git-types";
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

export interface ResolvedWorktreeBaseBranch {
  ref: string;
  fetchFailureFallback: boolean;
}

function resolvedBaseBranch(
  ref: string | null,
  automaticRemoteRef: string | null,
): ResolvedWorktreeBaseBranch | null {
  if (ref === null) return null;
  return { ref, fetchFailureFallback: ref === automaticRemoteRef };
}

export async function resolveWorktreeBaseBranch(
  sourcePath: string,
  requested: WorktreeBaseBranch,
): Promise<ResolvedWorktreeBaseBranch | null> {
  if (requested.kind === "named") {
    if (
      requested.name.startsWith("refs/") ||
      (await hasRef(sourcePath, `refs/remotes/${requested.name}`))
    )
      return resolvedBaseBranch(requested.name, null);
    const [hasLocalBranch, hasRemoteBranch] = await Promise.all([
      hasRef(sourcePath, `refs/heads/${requested.name}`),
      hasRef(sourcePath, `refs/remotes/origin/${requested.name}`),
    ]);
    if (!hasRemoteBranch) return resolvedBaseBranch(requested.name, null);
    const localBranch = hasLocalBranch ? requested.name : null;
    const remoteBranch = `origin/${requested.name}`;
    return resolvedBaseBranch(
      resolveDefaultWorktreeBaseBranch({
        defaultBranch: localBranch,
        originDefaultBranch: remoteBranch,
        defaultBranchRelation:
          (await readBranchRelation(
            sourcePath,
            localBranch ?? undefined,
            remoteBranch,
          )) ?? null,
      }),
      remoteBranch,
    );
  }
  const refs = await readDefaultBranchRefs(sourcePath);
  const originDefaultBranch = refs.originDefaultBranch ?? null;
  return resolvedBaseBranch(
    resolveDefaultWorktreeBaseBranch({
      defaultBranch: refs.defaultBranch ?? null,
      defaultBranchRelation: refs.defaultBranchRelation ?? null,
      originDefaultBranch,
    }),
    originDefaultBranch,
  );
}
