import type {
  DiffFileEntry,
  GitDiffFileChangeKind,
  RawDiffFileStat,
} from "../contract.js";

export const DIFF_FILE_AUTO_LOAD_MAX_CHANGED_LINES = 500;
export const DIFF_FILE_TOO_LARGE_CHANGED_LINES = 20_000;
export const DIFF_FILES_INLINE_PATCH_MAX_FILES = 10;

const CHANGE_KIND_BY_LETTER: Record<
  RawDiffFileStat["statusLetter"],
  GitDiffFileChangeKind
> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type_changed",
};

function resolveLoadMode(
  changedLines: number,
  binary: boolean,
): DiffFileEntry["loadMode"] {
  if (changedLines > DIFF_FILE_TOO_LARGE_CHANGED_LINES) return "too_large";
  if (binary || changedLines > DIFF_FILE_AUTO_LOAD_MAX_CHANGED_LINES) return "on_demand";
  return "auto";
}

export function toDiffFileEntry(stat: RawDiffFileStat): DiffFileEntry {
  return {
    path: stat.path,
    previousPath: stat.previousPath,
    changeKind: CHANGE_KIND_BY_LETTER[stat.statusLetter],
    additions: stat.additions,
    deletions: stat.deletions,
    binary: stat.binary,
    origin: stat.origin,
    loadMode: resolveLoadMode(stat.additions + stat.deletions, stat.binary),
    revision: stat.revision,
  };
}

export function selectInitialPatchPaths(files: DiffFileEntry[]): string[] {
  if (files.length > DIFF_FILES_INLINE_PATCH_MAX_FILES) return [];
  return files.filter((file) => file.loadMode === "auto").map((file) => file.path);
}
