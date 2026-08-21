import {
  isCsvFilePreview,
  isHtmlFilePreviewPath,
  isMarkdownFilePreview,
  type FilePreview,
  type FilePreviewLineRange,
} from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import { FILE_TOO_LARGE_ERROR_CODE } from "./file-preview-fetch";

/**
 * Pure presentation decisions for a file preview (ports of the web's
 * `SecondaryPanelFilePreview` state mapping and the `FilePreview.tsx`
 * helpers: CSV parsing, code truncation budgets, line-selection text).
 */

export type TextFilePreviewKind = "code" | "markdown" | "csv";

/**
 * What the preview body renders. `text` covers code / markdown / CSV (the
 * renderer picks by `textKind`); `html` carries both the source and the raw
 * route URL for the WebView; `image` / `video` carry a loadable URL.
 */
export type FilePreviewContent =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "too-large"; message: string }
  | { kind: "error"; message: string }
  | { kind: "empty" }
  | {
      kind: "text";
      content: string;
      textKind: TextFilePreviewKind;
      mimeType: string;
    }
  | { kind: "html"; content: string | null; rawUrl: string }
  | { kind: "image"; url: string; mimeType: string }
  | { kind: "video"; url: string; mimeType: string }
  | { kind: "unsupported"; mimeType: string };

export interface ResolveFilePreviewContentArgs {
  activePath: string;
  preview: FilePreview | undefined;
  error: unknown;
  isLoading: boolean;
  /**
   * Raw route URL for an HTML file at this path (worktree / storage / host
   * raw routes), or null when the source has none (project files, non-working-tree
   * workspace sources) — then HTML renders as source.
   */
  htmlRawUrl: string | null;
}

function describeFilePreviewError(error: unknown): string {
  if (error instanceof BbHttpError) {
    if (error.status === 404) return "File not found.";
    if (error.code === FILE_TOO_LARGE_ERROR_CODE || error.status === 413) {
      return "This file is too large to preview.";
    }
    return error.message.replace(/^HTTP \d+: /u, "");
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Could not load this file.";
}

function textKindOf(preview: Extract<FilePreview, { kind: "text" }>) {
  if (isCsvFilePreview(preview)) return "csv" as const;
  if (isMarkdownFilePreview(preview)) return "markdown" as const;
  return "code" as const;
}

/** Decide the body for one preview read (web `SecondaryPanelFilePreview`). */
export function resolveFilePreviewContent({
  activePath,
  preview,
  error,
  isLoading,
  htmlRawUrl,
}: ResolveFilePreviewContentArgs): FilePreviewContent {
  if (error) {
    if (error instanceof BbHttpError) {
      if (error.status === 404) return { kind: "not-found" };
      if (error.code === FILE_TOO_LARGE_ERROR_CODE || error.status === 413) {
        return { kind: "too-large", message: describeFilePreviewError(error) };
      }
    }
    return { kind: "error", message: describeFilePreviewError(error) };
  }
  if (isLoading || preview === undefined || preview.path !== activePath) {
    return { kind: "loading" };
  }
  if (htmlRawUrl !== null && isHtmlFilePreviewPath(activePath)) {
    return {
      kind: "html",
      content: preview.kind === "text" ? preview.content : null,
      rawUrl: htmlRawUrl,
    };
  }
  switch (preview.kind) {
    case "text":
      if (preview.content.length === 0) return { kind: "empty" };
      return {
        kind: "text",
        content: preview.content,
        textKind: textKindOf(preview),
        mimeType: preview.mimeType,
      };
    case "image":
      return { kind: "image", url: preview.url, mimeType: preview.mimeType };
    case "video":
      return { kind: "video", url: preview.url, mimeType: preview.mimeType };
    case "unsupported":
      return { kind: "unsupported", mimeType: preview.mimeType };
  }
}

// --- Code truncation ------------------------------------------------------------

/**
 * Code previews above either budget render only a leading prefix until the
 * user asks for the whole file (laying out thousands of monospace rows is
 * what stalls the phone; the prefix keeps the first paint bounded).
 */
const FILE_PREVIEW_CODE_MAX_LINES = 2_000;
const FILE_PREVIEW_CODE_MAX_CHARS = 256 * 1024;

export interface FilePreviewCodeTruncation {
  /** The rendered prefix, cut at a line boundary. */
  contents: string;
  renderedLineCount: number;
  totalLineCount: number;
}

function countLines(contents: string): number {
  if (contents.length === 0) return 0;
  let count = 1;
  for (let index = contents.indexOf("\n"); index !== -1; ) {
    count += 1;
    index = contents.indexOf("\n", index + 1);
  }
  return contents.endsWith("\n") ? count - 1 : count;
}

/**
 * Returns the leading prefix that fits both budgets, or null when the whole
 * file fits (web `truncateFilePreviewCode`).
 */
export function truncateFilePreviewCode(
  contents: string,
  limits: { maxLines?: number; maxChars?: number } = {},
): FilePreviewCodeTruncation | null {
  const maxLines = limits.maxLines ?? FILE_PREVIEW_CODE_MAX_LINES;
  const maxChars = limits.maxChars ?? FILE_PREVIEW_CODE_MAX_CHARS;
  const totalLineCount = countLines(contents);
  if (contents.length <= maxChars && totalLineCount <= maxLines) {
    return null;
  }
  let renderedLineCount = 0;
  let cutIndex = 0;
  for (
    let lineStart = 0;
    lineStart < contents.length && renderedLineCount < maxLines;
  ) {
    const newlineIndex = contents.indexOf("\n", lineStart);
    const lineEnd = newlineIndex === -1 ? contents.length : newlineIndex;
    if (lineEnd > maxChars && renderedLineCount > 0) {
      break;
    }
    renderedLineCount += 1;
    cutIndex = lineEnd;
    lineStart = lineEnd + 1;
  }
  return {
    contents: contents.slice(0, cutIndex),
    renderedLineCount,
    totalLineCount,
  };
}

/** Split file contents into display lines (trailing newline → no phantom line). */
export function splitPreviewLines(contents: string): string[] {
  if (contents.length === 0) return [];
  const lines = contents.split(/\r\n|\n|\r/u);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// --- CSV ---------------------------------------------------------------------------

export interface CsvPreviewData {
  columnCount: number;
  rows: string[][];
  truncatedColumns: boolean;
  truncatedRows: boolean;
}

interface ParsedCsvRows {
  rows: string[][];
  truncatedRows: boolean;
}

const CSV_PREVIEW_MAX_COLUMNS = 50;
const CSV_PREVIEW_MAX_ROWS = 300;

/** RFC 4180-ish parser that stops once `maxRows` rows are collected. */
export function parseCsvRows(contents: string, maxRows: number): ParsedCsvRows {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let quotedField = false;
  let endedWithLineBreak = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    endedWithLineBreak = false;

    if (inQuotes) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
      quotedField = true;
      continue;
    }

    if (character === ",") {
      row.push(field);
      field = "";
      quotedField = false;
      continue;
    }

    if (character === "\n" || character === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      quotedField = false;
      endedWithLineBreak = true;
      if (character === "\r" && contents[index + 1] === "\n") {
        index += 1;
      }
      if (rows.length >= maxRows) {
        return { rows, truncatedRows: index + 1 < contents.length };
      }
      continue;
    }

    field += character;
  }

  if (
    field.length > 0 ||
    row.length > 0 ||
    quotedField ||
    !endedWithLineBreak
  ) {
    row.push(field);
    rows.push(row);
  }

  return { rows, truncatedRows: false };
}

export function buildCsvPreviewData(contents: string): CsvPreviewData {
  // +1: the first parsed row is the header, so the cap counts data rows.
  const { rows, truncatedRows } = parseCsvRows(
    contents,
    CSV_PREVIEW_MAX_ROWS + 1,
  );
  const columnCount = rows.reduce(
    (maximum, row) => Math.max(maximum, row.length),
    0,
  );
  return {
    columnCount: Math.min(columnCount, CSV_PREVIEW_MAX_COLUMNS),
    rows,
    truncatedColumns: columnCount > CSV_PREVIEW_MAX_COLUMNS,
    truncatedRows,
  };
}

export function getCsvTruncationNote(preview: CsvPreviewData): string | null {
  const limits: string[] = [];
  if (preview.truncatedRows) {
    limits.push(`${CSV_PREVIEW_MAX_ROWS.toLocaleString("en-US")} rows`);
  }
  if (preview.truncatedColumns) {
    limits.push(`${preview.columnCount.toLocaleString("en-US")} columns`);
  }
  if (limits.length === 0) return null;
  return `Showing the first ${limits.join(" and ")}.`;
}

// --- Line selection → "Add to chat" ----------------------------------------------

export function formatLineRange(
  startLineNumber: number,
  endLineNumber: number,
): string {
  return startLineNumber === endLineNumber
    ? String(startLineNumber)
    : `${startLineNumber}-${endLineNumber}`;
}

export interface BuildFileLineSelectionTextArgs {
  contents: string;
  /** Path as the user sees it (workspace-relative or absolute). */
  path: string;
  range: FilePreviewLineRange;
}

/**
 * `path:L\n<lines>` — what "Add to chat" quotes for a long-pressed line
 * (web `buildFilePreviewLineSelectionText`). Null when the range is off the
 * end of the file or only whitespace.
 */
export function buildFileLineSelectionText({
  contents,
  path,
  range,
}: BuildFileLineSelectionTextArgs): string | null {
  const lines = contents.split(/\r\n|\n|\r/u);
  const selectedLines = lines.slice(
    range.startLineNumber - 1,
    range.endLineNumber,
  );
  if (selectedLines.length === 0) return null;
  const selectedText = selectedLines.join("\n").trimEnd();
  if (selectedText.trim().length === 0) return null;
  return `${path}:${formatLineRange(range.startLineNumber, range.endLineNumber)}\n${selectedText}`;
}

/** `path:line` (or `path:start-end`) reference without the content. */
export function formatFileLineReference(
  path: string,
  range: FilePreviewLineRange | null,
): string {
  return range === null
    ? path
    : `${path}:${formatLineRange(range.startLineNumber, range.endLineNumber)}`;
}

// --- Misc -----------------------------------------------------------------------------

export function getFileName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
  return trimmed.split(/[\\/]/u).at(-1) || path;
}

export function getParentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/u, "");
  const index = trimmed.lastIndexOf("/");
  if (index < 0) return "";
  return index === 0 ? "/" : trimmed.slice(0, index);
}

/** `1.2 KB` / `3.4 MB`; bytes under 1 KB print the exact count. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
