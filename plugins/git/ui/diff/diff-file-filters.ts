import type { DiffFileEntry } from "../../contract.js";
import { filterDiffFilesByPath } from "./filter-diff-files.js";

export interface DiffFileFilters {
  selectedExtensions: readonly string[];
  showDeleted: boolean;
  showViewed: boolean;
}

export const DEFAULT_DIFF_FILE_FILTERS: DiffFileFilters = {
  selectedExtensions: [],
  showDeleted: true,
  showViewed: true,
};

export function diffFileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : "";
}

export function diffExtensionCounts(files: readonly DiffFileEntry[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    const extension = diffFileExtension(file.path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b));
}

export function hasDiffFileFilters(filters: DiffFileFilters): boolean {
  return (
    filters.selectedExtensions.length > 0 ||
    !filters.showDeleted ||
    !filters.showViewed
  );
}

export function filterDiffFiles(
  files: readonly DiffFileEntry[],
  query: string,
  filters: DiffFileFilters,
  viewedRevisionByPath: ReadonlyMap<string, string>,
): readonly DiffFileEntry[] {
  return filterDiffFilesByPath(files, query).filter(
    (file) =>
      (filters.selectedExtensions.length === 0 ||
        filters.selectedExtensions.includes(diffFileExtension(file.path))) &&
      (filters.showDeleted || file.changeKind !== "deleted") &&
      (filters.showViewed ||
        viewedRevisionByPath.get(file.path) !== file.revision),
  );
}
