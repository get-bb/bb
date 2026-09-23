import path from "node:path";

export interface GitWorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
  isBare: boolean;
  locked: boolean;
  prunable: boolean;
}

const MAX_ENTRIES = 500;

export function parseWorktreeListPorcelain(stdout: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;

  const flush = () => {
    if (current !== null) entries.push(current);
    current = null;
  };

  for (const field of stdout.split("\0")) {
    if (field === "") {
      flush();
      continue;
    }
    if (entries.length >= MAX_ENTRIES) break;
    const separator = field.indexOf(" ");
    const key = separator === -1 ? field : field.slice(0, separator);
    const value = separator === -1 ? "" : field.slice(separator + 1);
    if (key === "worktree") {
      flush();
      current = {
        path: value,
        branch: null,
        isMain: entries.length === 0,
        isBare: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (current === null) continue;
    if (key === "branch") {
      current.branch = value.startsWith("refs/heads/")
        ? value.slice("refs/heads/".length)
        : value;
    } else if (key === "bare") {
      current.isBare = true;
    } else if (key === "locked") {
      current.locked = true;
    } else if (key === "prunable") {
      current.prunable = true;
    }
  }
  flush();
  return entries.slice(0, MAX_ENTRIES);
}

export function selectAdoptableWorktrees(args: {
  entries: readonly GitWorktreeEntry[];
  managedRoot: string;
}): GitWorktreeEntry[] {
  return args.entries.filter((entry) => {
    if (entry.isMain || entry.isBare) return false;
    if (entry.path === "") return false;
    return !isInside(args.managedRoot, entry.path);
  });
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(comparisonKey(root), comparisonKey(candidate));
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function findWorktreeEntry(
  entries: readonly GitWorktreeEntry[],
  path: string,
): GitWorktreeEntry | null {
  const key = comparisonKey(path);
  return entries.find((entry) => comparisonKey(entry.path) === key) ?? null;
}

// bb-fork(windows): git prints worktree paths with `/`; compare native resolved
// paths and fold case on Windows.
function comparisonKey(value: string): string {
  const normalized = path.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}
