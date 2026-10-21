import type { WorkspaceDiffTarget } from "bb-git-contract";

export function viewedTargetKey(target: WorkspaceDiffTarget): string {
  switch (target.type) {
    case "uncommitted":
      return "uncommitted";
    case "branch_committed":
    case "all":
      return `${target.type}:${target.mergeBaseBranch}`;
    case "commit":
      return `commit:${target.sha.toLowerCase()}`;
  }
}
export function viewedStorageKey(
  environmentId: string,
  target: WorkspaceDiffTarget,
  path: string,
) {
  return `viewed/${JSON.stringify([environmentId, viewedTargetKey(target), path])}`;
}

export function viewedStoragePrefix(
  environmentId: string,
  target: WorkspaceDiffTarget,
) {
  return `viewed/${JSON.stringify([environmentId, viewedTargetKey(target)]).slice(0, -1)},`;
}
