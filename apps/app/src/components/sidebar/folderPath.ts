// Pure helpers for sidebar folders. Thread titles are display text; folder
// membership lives in `thread.folderPath`.

function splitPathSegments(value: string): string[] {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function splitFolderPath(
  folderPath: string | null | undefined,
): string[] {
  if (!folderPath) {
    return [];
  }
  return splitPathSegments(folderPath);
}

export function normalizeFolderPath(
  folderPath: string | null | undefined,
): string | null {
  const normalized = splitFolderPath(folderPath).join("/");
  return normalized.length > 0 ? normalized : null;
}

// Every ancestor folder key for a stored folder path, outermost first — e.g.
// "Work/Q3" in container "p" → ["p::Work", "p::Work/Q3"]. Used to un-collapse
// the folders hiding a selected thread.
export function folderAncestorKeys(
  containerId: string,
  folderPath: string | null | undefined,
): string[] {
  const folders = splitFolderPath(folderPath);
  const keys: string[] = [];
  for (let depth = 1; depth <= folders.length; depth += 1) {
    keys.push(buildFolderKey(containerId, folders.slice(0, depth)));
  }
  return keys;
}

// Human-readable folder path, used for tooltips and accessible names. The
// visible separator differs from the stored "/" so paths read as breadcrumbs.
export const FOLDER_PATH_SEPARATOR = " › ";

export function formatFolderPathLabel(segments: readonly string[]): string {
  return segments.join(FOLDER_PATH_SEPARATOR);
}

// Stable identity for a folder within a section. `containerId` is the owner of
// the section — a `proj_*` id for project sections, or a fixed sentinel for the
// global sections — so "Work" in project A never collides with "Work" in
// project B or in pinned. Renaming an ancestor segment changes the key, which
// intentionally resets that folder's collapse state (it is a different folder).
export function buildFolderKey(
  containerId: string,
  path: readonly string[],
): string {
  return `${containerId}::${path.join("/")}`;
}

// How many folder rows are currently both visible and open — i.e. the folder is
// not collapsed AND none of its ancestors are collapsed (so its row renders).
// Drives the "show row actions inline when the sidebar is sparse" rule.
export function countVisibleExpandedFolders(
  folderPaths: readonly string[],
  containerId: string,
  collapsedFolderKeys: ReadonlySet<string>,
): number {
  let count = 0;
  for (const folderPath of folderPaths) {
    const keyChain = folderAncestorKeys(containerId, folderPath);
    if (keyChain.length === 0) {
      continue;
    }
    // keyChain is [self-and-ancestors]; the row is a visible, open container
    // only when every link in that chain is expanded.
    if (keyChain.every((key) => !collapsedFolderKeys.has(key))) {
      count += 1;
    }
  }
  return count;
}
