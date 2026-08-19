// Repo → BB project names, and the project-name ordering the pull-request
// surfaces use. A cached item only knows its `owner/repo`, so the project it
// belongs to is resolved through the tracked-repo list. Shared by the server
// (the `bb github prs` CLI) and the app bundle (the PR table) so both order
// the same way.

/** The part of a tracked repo entry that carries its BB project name. */
export interface RepoProjectName {
  repo: string;
  projectName: string | null;
}

/**
 * `owner/repo` → project name, skipping repos with no BB project (tracked
 * through the `extraRepos` setting) so a lookup miss means "no project".
 */
export function projectNamesByRepo(
  repos: readonly RepoProjectName[],
): Map<string, string> {
  const byRepo = new Map<string, string>();
  for (const entry of repos) {
    const name = entry.projectName?.trim() ?? "";
    if (name.length > 0) byRepo.set(entry.repo, name);
  }
  return byRepo;
}

/**
 * Case-insensitive project-name order; repos with no BB project sort last.
 * Names that differ only in case still group together, and deterministically,
 * via the raw tiebreak.
 */
export function compareProjectNames(
  left: string | undefined,
  right: string | undefined,
): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  const folded = left.localeCompare(right, undefined, { sensitivity: "base" });
  if (folded !== 0) return folded;
  return left < right ? -1 : 1;
}

/**
 * Group items by their repo's BB project name. The sort is stable, so items
 * inside one project keep the order they came in with — newest-updated first,
 * the order the cache returns.
 */
export function sortByProjectName<T extends { repo: string }>(
  items: readonly T[],
  repos: readonly RepoProjectName[],
): T[] {
  const names = projectNamesByRepo(repos);
  return [...items].sort((left, right) =>
    compareProjectNames(names.get(left.repo), names.get(right.repo)),
  );
}
