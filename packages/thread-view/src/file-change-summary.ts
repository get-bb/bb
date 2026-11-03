import {
  formatTimelinePath,
  type TimelinePathDisplayMode,
} from "./timeline-path-display.js";

export type FileChangeAction = "created" | "deleted" | "renamed" | "edited";

interface FileChangeDiffStats {
  added: number;
  removed: number;
}

interface FileChangeLike {
  path: string;
  kind?: string | null;
  movePath?: string | null;
  diff?: string | null;
  diffStats?: { added: number; removed: number };
}

interface FormatFileChangePathArgs {
  change: FileChangeLike;
  mode: TimelinePathDisplayMode;
}

function normalizeFileChangeKind(kind: string | null | undefined): string {
  return (kind ?? "").toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

export function isPatchMetadataLine(line: string): boolean {
  const normalizedLine = line.trimEnd();
  return (
    normalizedLine.startsWith("diff --git ") ||
    normalizedLine.startsWith("index ") ||
    normalizedLine.startsWith("new file mode ") ||
    normalizedLine.startsWith("deleted file mode ") ||
    normalizedLine.startsWith("similarity index ") ||
    normalizedLine.startsWith("rename from ") ||
    normalizedLine.startsWith("rename to ") ||
    normalizedLine.startsWith("--- ") ||
    normalizedLine.startsWith("+++ ") ||
    normalizedLine.startsWith("@@") ||
    normalizedLine === "\\ No newline at end of file"
  );
}

function splitDiffLines(diff: string): string[] {
  const lines = diff.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function isChangedLine(line: string): boolean {
  return line.startsWith("+") || line.startsWith("-");
}

function hasSubstantiveDiff(change: FileChangeLike): boolean {
  const diff = change.diff;
  if (!diff) {
    return (
      (change.diffStats?.added ?? 0) + (change.diffStats?.removed ?? 0) > 0
    );
  }
  return splitDiffLines(diff).some(
    (line) => !isPatchMetadataLine(line) && isChangedLine(line),
  );
}

export function getFileChangeAction(change: FileChangeLike): FileChangeAction {
  if (change.movePath) {
    return hasSubstantiveDiff(change) ? "edited" : "renamed";
  }

  const kind = normalizeFileChangeKind(change.kind);
  if (kind.includes("add") || kind.includes("create")) return "created";
  if (kind.includes("delete") || kind.includes("remove")) return "deleted";
  return "edited";
}

export function getFileChangeActionPastTense(action: FileChangeAction): string {
  switch (action) {
    case "created":
      return "Created";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "edited":
      return "Edited";
  }
}

export function getFileChangeActionPresentTense(
  action: FileChangeAction,
): string {
  switch (action) {
    case "created":
      return "Creating";
    case "deleted":
      return "Deleting";
    case "renamed":
      return "Renaming";
    case "edited":
      return "Editing";
  }
}

export function getFileChangeActionInfinitive(
  action: FileChangeAction,
): string {
  switch (action) {
    case "created":
      return "create";
    case "deleted":
      return "delete";
    case "renamed":
      return "rename";
    case "edited":
      return "edit";
  }
}

export function formatFileChangePath({
  change,
  mode,
}: FormatFileChangePathArgs): string {
  const sourcePath = formatTimelinePath({ path: change.path, mode });
  if (!change.movePath) {
    return sourcePath;
  }
  if (getFileChangeAction(change) === "edited") {
    return formatTimelinePath({ path: change.movePath, mode });
  }
  return `${sourcePath} -> ${formatTimelinePath({
    path: change.movePath,
    mode,
  })}`;
}

function isWholeFileChange(change: FileChangeLike): boolean {
  const action = getFileChangeAction(change);
  return action === "created" || action === "deleted";
}

export function isPlainFileContentDiff(change: FileChangeLike): boolean {
  return (
    !!change.diff &&
    isWholeFileChange(change) &&
    !isPatchMetadataLine(splitDiffLines(change.diff)[0] ?? "")
  );
}

export function getFileChangeDiffLines(change: FileChangeLike): string[] {
  if (!change.diff) {
    return [];
  }
  const lines = splitDiffLines(change.diff);
  const prefix = getFileChangeAction(change) === "created" ? "+" : "-";
  if (isPlainFileContentDiff(change)) {
    return lines.map((line) => `${prefix}${line}`);
  }
  const bodyLines = lines.filter((line) => !isPatchMetadataLine(line));
  if (isWholeFileChange(change) && !bodyLines.some(isChangedLine)) {
    return bodyLines.map((line) => `${prefix}${line}`);
  }
  return bodyLines;
}

export function getFileChangeDiffStats(
  change: FileChangeLike,
): FileChangeDiffStats {
  let added = 0;
  let removed = 0;
  for (const line of getFileChangeDiffLines(change)) {
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }
  return { added, removed };
}
