import { parsePatchFiles } from "@pierre/diffs";
import type { GitDiffFileChangeKind } from "@bb/server-contract";

export type ParsedGitDiffFile = ReturnType<
  typeof parsePatchFiles
>[number]["files"][number];

export type { GitDiffFileChangeKind };

export interface GitDiffStats {
  filesCount: number;
  insertions: number;
  deletions: number;
}

export function parseGitDiffFiles(
  diff: string,
): ReturnType<typeof parsePatchFiles>[number]["files"] {
  if (diff.trim().length === 0) return [];
  try {
    return parsePatchFiles(diff).flatMap((patch) => patch.files);
  } catch {
    return [];
  }
}

export function summarizeGitDiff(
  files: ParsedGitDiffFile[],
  diff: string,
): GitDiffStats {
  if (files.length > 0) {
    let insertions = 0;
    let deletions = 0;
    for (const file of files) {
      const fileStats = summarizeGitDiffFile(file);
      insertions += fileStats.insertions;
      deletions += fileStats.deletions;
    }
    return { filesCount: files.length, insertions, deletions };
  }

  let insertions = 0;
  let deletions = 0;
  let filesCount = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      filesCount += 1;
      continue;
    }
    if (line.startsWith("+++ ")) continue;
    if (line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      insertions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return {
    filesCount:
      filesCount > 0 ? filesCount : insertions > 0 || deletions > 0 ? 1 : 0,
    insertions,
    deletions,
  };
}

export function summarizeGitDiffFile(
  file: ParsedGitDiffFile,
): Pick<GitDiffStats, "insertions" | "deletions"> {
  let insertions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    insertions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { insertions, deletions };
}

export function getGitDiffFileChangeKind(
  file: ParsedGitDiffFile,
): GitDiffFileChangeKind {
  switch (file.type) {
    case "new":
      return "added";
    case "deleted":
      return "deleted";
    case "rename-pure":
    case "rename-changed":
      return "renamed";
    case "change":
      return "modified";
    default: {
      const _exhaustive: never = file.type;
      return _exhaustive;
    }
  }
}

export function formatGitDiffFileLabel(file: ParsedGitDiffFile): string {
  const name = normalizeGitDiffPath(file.name) ?? file.name;
  const prevName = normalizeGitDiffPath(file.prevName);
  if (prevName && prevName !== name) {
    return `${prevName} -> ${name}`;
  }
  return name;
}

export function normalizeGitDiffPath(
  path: string | undefined,
): string | undefined {
  const trimmedPath = path?.trim();
  return trimmedPath && trimmedPath.length > 0 ? trimmedPath : undefined;
}

// Browser-renderable raster formats only. SVG is deliberately absent. SVG
// diffs arrive as regular text hunks, which are more informative than a
// rendered preview. TIFF/HEIC are absent because `<img>` can't render them
// in every browser we support.
const IMAGE_GIT_DIFF_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

export function isImageGitDiffFile(file: ParsedGitDiffFile): boolean {
  const path = normalizeGitDiffPath(file.name) ?? file.name;
  const extension = path.split(".").pop()?.toLowerCase();
  return (
    extension !== undefined && IMAGE_GIT_DIFF_FILE_EXTENSIONS.has(extension)
  );
}

function getGitDiffPathAliases(path: string | undefined): string[] {
  const cleanPath = normalizeGitDiffPath(path);
  if (!cleanPath || cleanPath === "/dev/null") return [];
  const normalizedPath = cleanPath.startsWith("./")
    ? cleanPath.slice(2)
    : cleanPath;
  if (normalizedPath.length === 0) return [];
  const aliases = [normalizedPath];
  if (normalizedPath.startsWith("a/") || normalizedPath.startsWith("b/")) {
    aliases.push(normalizedPath.slice(2));
  }
  return Array.from(new Set(aliases.filter((alias) => alias.length > 0)));
}

export function getOpenableGitDiffPath(file: ParsedGitDiffFile): string | null {
  for (const candidatePath of [file.name, file.prevName]) {
    const aliases = getGitDiffPathAliases(candidatePath);
    if (aliases.length > 0) {
      return aliases[aliases.length - 1] ?? null;
    }
  }
  return null;
}
