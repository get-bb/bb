/**
 * Pure view-model helpers for the native diff renderer: flattens a file's
 * hunks into the row list the components draw, applies the "show more" cap,
 * and sizes the line-number gutter. No React Native imports.
 */
import type { DiffHunk, DiffLine } from "./parse-unified-diff";

export interface DiffHunkSource {
  hunks: readonly DiffHunk[];
}

export type DiffRow =
  | { kind: "hunk"; key: string; header: string }
  | { kind: "line"; key: string; line: DiffLine }
  | { kind: "more"; key: string; hiddenLines: number };

/** Lines shown before a large diff collapses behind "Show N more lines". */
export const DIFF_DEFAULT_MAX_LINES = 160;
/**
 * Do not bother collapsing when fewer than this many lines would hide; a
 * "Show 3 more lines" button costs more than it saves.
 */
const DIFF_COLLAPSE_SLACK = 20;

export interface BuildDiffRowsOptions {
  /** Visible line cap when not expanded; `Infinity` disables the cap. */
  maxLines?: number;
  expanded?: boolean;
}

export interface DiffRowsResult {
  rows: DiffRow[];
  /** Line rows hidden behind the `more` row (0 when none). */
  hiddenLines: number;
  totalLines: number;
}

function flattenHunks(hunks: readonly DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  hunks.forEach((hunk, hunkIndex) => {
    rows.push({ kind: "hunk", key: `h${hunkIndex}`, header: hunk.header });
    hunk.lines.forEach((line, lineIndex) => {
      rows.push({ kind: "line", key: `h${hunkIndex}:${lineIndex}`, line });
    });
  });
  return rows;
}

export function buildDiffRows(
  file: DiffHunkSource,
  options: BuildDiffRowsOptions = {},
): DiffRowsResult {
  const maxLines = options.maxLines ?? DIFF_DEFAULT_MAX_LINES;
  const all = flattenHunks(file.hunks);
  const totalLines = all.reduce(
    (count, row) => (row.kind === "line" ? count + 1 : count),
    0,
  );
  if (
    options.expanded ||
    !Number.isFinite(maxLines) ||
    totalLines <= maxLines + DIFF_COLLAPSE_SLACK
  ) {
    return { rows: all, hiddenLines: 0, totalLines };
  }

  const rows: DiffRow[] = [];
  let shown = 0;
  for (const row of all) {
    if (row.kind === "line") {
      if (shown >= maxLines) break;
      shown += 1;
    } else if (shown >= maxLines) {
      // A hunk header right at the cap belongs with the hidden lines.
      break;
    }
    rows.push(row);
  }
  const hiddenLines = totalLines - shown;
  rows.push({ kind: "more", key: "more", hiddenLines });
  return { rows, hiddenLines, totalLines };
}

/** Digits needed for the widest line number in the file (at least 2). */
export function maxLineNumberDigits(file: DiffHunkSource): number {
  let max = 0;
  for (const hunk of file.hunks) {
    max = Math.max(
      max,
      hunk.oldStart + hunk.oldLines,
      hunk.newStart + hunk.newLines,
    );
  }
  return Math.max(2, String(Math.max(0, max)).length);
}

/** Tabs render at unpredictable widths in RN Text; expand them like `tab-size: 4`. */
export function formatDiffLineText(text: string): string {
  return text.includes("\t") ? text.replaceAll("\t", "    ") : text;
}
