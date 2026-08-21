import type { DiffFile, DiffHunk } from "@/diff/parse-unified-diff";

/**
 * "Add to chat" text for the diff tab (mirror of the patch-text builders in
 * apps/app/src/components/git-diff/GitDiffCardBody.tsx): a unified patch for
 * one file — `diff --git` + `---`/`+++` headers, then the hunks — that the
 * composer quotes line by line (`> …`). The agent gets the path and the
 * exact changed lines. Pure, vitest-tested.
 */

const DEV_NULL = "/dev/null";

function formatRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

function hunkHeader(hunk: DiffHunk): string {
  const header = hunk.header.trim();
  if (header.startsWith("@@")) return header;
  return `@@ -${formatRange(hunk.oldStart, hunk.oldLines)} +${formatRange(
    hunk.newStart,
    hunk.newLines,
  )} @@`;
}

function hunkLines(hunk: DiffHunk): string[] {
  const lines = [hunkHeader(hunk)];
  for (const line of hunk.lines) {
    switch (line.type) {
      case "add":
        lines.push(`+${line.text}`);
        break;
      case "del":
        lines.push(`-${line.text}`);
        break;
      case "context":
        lines.push(` ${line.text}`);
        break;
      case "meta":
        lines.push(line.text);
        break;
    }
  }
  return lines;
}

export interface BuildDiffAddToChatTextOptions {
  /** Quote only this hunk (index into `file.hunks`); all hunks by default. */
  hunkIndex?: number;
  /** Strip this root from the path so the quote is repo-relative. */
  workspaceRootPath?: string | null;
}

function relativePath(
  path: string,
  workspaceRootPath: string | null | undefined,
): string {
  if (!workspaceRootPath) return path;
  const root = workspaceRootPath.replace(/\/+$/u, "");
  return root.length > 0 && path.startsWith(`${root}/`)
    ? path.slice(root.length + 1)
    : path;
}

/**
 * The quoted text for one file. Files without hunks (binary, pure rename, a
 * patch that is not loaded yet) quote just the header so the agent still gets
 * the path; `hunkIndex` narrows a loaded file to one hunk.
 */
export function buildDiffAddToChatText(
  file: DiffFile,
  options: BuildDiffAddToChatTextOptions = {},
): string {
  const path = relativePath(file.path, options.workspaceRootPath);
  const previousPath = relativePath(
    file.previousPath ?? file.path,
    options.workspaceRootPath,
  );
  const oldHeader =
    file.changeKind === "added" ? DEV_NULL : `a/${previousPath}`;
  const newHeader = file.changeKind === "deleted" ? DEV_NULL : `b/${path}`;
  const lines = [
    `diff --git a/${previousPath} b/${path}`,
    `--- ${oldHeader}`,
    `+++ ${newHeader}`,
  ];
  if (file.binary) {
    lines.push(`Binary files ${oldHeader} and ${newHeader} differ`);
    return lines.join("\n");
  }
  const hunks =
    options.hunkIndex === undefined
      ? file.hunks
      : file.hunks.slice(options.hunkIndex, options.hunkIndex + 1);
  for (const hunk of hunks) {
    lines.push(...hunkLines(hunk));
  }
  return lines.join("\n");
}

/** The quote for a file whose patch is not loaded: just its path. */
export function buildDiffPathAddToChatText(
  path: string,
  workspaceRootPath?: string | null,
): string {
  return relativePath(path, workspaceRootPath);
}
