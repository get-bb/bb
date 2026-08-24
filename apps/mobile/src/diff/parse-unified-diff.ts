/**
 * Unified-diff parser for the native diff renderer. Wraps `parse-git-diff`
 * (hunk + extended-header parsing) in our own, renderer-shaped types and adds
 * the tolerance the web renderer (@pierre/diffs) has and `parse-git-diff`
 * lacks:
 *
 * - patches without a `diff --git` line (bare `---`/`+++`/`@@`) get a
 *   synthesized one per file;
 * - each file is parsed from its own segment, so a malformed file never drops
 *   the files after it;
 * - blank lines inside a hunk (providers often strip the leading space from
 *   empty context lines) are read as empty context lines;
 * - `/dev/null` sides decide created/deleted even when `new file mode` /
 *   `deleted file mode` headers are absent (client-core's synthetic patches);
 * - `GIT binary patch` bodies and `Binary files … differ` mark the file binary
 *   instead of aborting the parse.
 *
 * Pure TypeScript (no React Native), vitest-tested.
 */
import type { GitDiffFileChangeKind } from "@bb/server-contract";
import parseGitDiff, {
  type AnyChunk,
  type AnyLineChange,
} from "parse-git-diff";

export type DiffLineType = "context" | "add" | "del" | "meta";

export interface DiffLine {
  type: DiffLineType;
  /** Line number in the old file (context and deleted lines). */
  oldNo?: number;
  /** Line number in the new file (context and added lines). */
  newNo?: number;
  /** Line content without the leading `+`/`-`/space marker. */
  text: string;
}

export interface DiffHunk {
  /** The `@@ -a,b +c,d @@ context` line as rendered. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

export type DiffChangeKind = GitDiffFileChangeKind;

export interface DiffFile {
  /** New path (or the old path for a delete), without the `a/`/`b/` prefix. */
  path: string;
  /** Rename/copy source; null otherwise. */
  previousPath: string | null;
  changeKind: DiffChangeKind;
  binary: boolean;
  hunks: DiffHunk[];
  stats: DiffStats;
}

export interface ParsedDiff {
  files: DiffFile[];
  stats: DiffStats & { files: number };
}

const DEV_NULL = "/dev/null";
const FILE_HEADER_PREFIX = "diff --";
const BINARY_PATCH_LINE = "GIT binary patch";
const BINARY_FILES_PATTERN = /^Binary files .* and .* differ$/u;

/** Splits on `\n` (CRLF-normalized) and drops the trailing empty line. */
export function splitDiffLines(patch: string): string[] {
  const normalized = patch.replaceAll("\r\n", "\n");
  if (normalized.length === 0) {
    return [];
  }
  const lines = normalized.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function isFileHeaderLine(line: string): boolean {
  return line.startsWith(FILE_HEADER_PREFIX);
}

function isHunkHeaderLine(line: string): boolean {
  return line.startsWith("@@");
}

/**
 * Groups the patch lines per file. Files normally start at `diff --git`
 * (`diff --cc` for combined diffs); in a patch without git headers a new file
 * starts at every `--- ` line directly followed by `+++ ` once the current
 * file already has its markers. Lines before the first file (format-patch
 * mail headers, prose) form a segment of their own that fails to parse and is
 * dropped.
 */
function splitFileSegments(lines: readonly string[]): string[][] {
  const segments: string[][] = [];
  let current: string[] | null = null;
  let currentHasGitHeader = false;
  let currentHasToMarker = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const startsGitFile = isFileHeaderLine(line);
    const startsBareFile =
      !startsGitFile &&
      line.startsWith("--- ") &&
      lines[index + 1]?.startsWith("+++ ") === true &&
      (current === null || (!currentHasGitHeader && currentHasToMarker));

    if (startsGitFile || startsBareFile || current === null) {
      current = [];
      segments.push(current);
      currentHasGitHeader = startsGitFile;
      currentHasToMarker = false;
    }
    if (!currentHasToMarker && line.startsWith("+++ ")) {
      currentHasToMarker = true;
    }
    current.push(line);
  }

  return segments;
}

function stripPrefix(path: string, prefix: "a/" | "b/"): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

function parseMarkerPath(line: string, prefix: "a/" | "b/"): string {
  // `--- a/path\t(timestamp)` is legal in unified diffs; git never emits the
  // tab, but diff(1) does.
  const raw = line.slice(4);
  const tabIndex = raw.indexOf("\t");
  const path = tabIndex === -1 ? raw : raw.slice(0, tabIndex);
  return path === DEV_NULL ? DEV_NULL : stripPrefix(path, prefix);
}

/**
 * `diff --git a/X b/Y` → `{ from: X, to: Y }`. Git quotes paths with spaces
 * or special characters; unquoted paths with spaces are split at the ` b/`
 * boundary, which is what git itself does when it can.
 */
function parseGitHeaderPaths(
  line: string,
): { from: string; to: string } | null {
  const rest = line.startsWith("diff --git ")
    ? line.slice("diff --git ".length)
    : line.startsWith("diff --cc ")
      ? line.slice("diff --cc ".length)
      : null;
  if (rest === null) return null;
  if (line.startsWith("diff --cc ")) {
    return { from: rest, to: rest };
  }
  const quoted = /^"(.*)" "(.*)"$/u.exec(rest);
  if (quoted) {
    return {
      from: stripPrefix(quoted[1]!, "a/"),
      to: stripPrefix(quoted[2]!, "b/"),
    };
  }
  const boundary = rest.indexOf(" b/");
  if (boundary !== -1) {
    return {
      from: stripPrefix(rest.slice(0, boundary), "a/"),
      to: rest.slice(boundary + 1 + "b/".length),
    };
  }
  const parts = rest.split(" ");
  if (parts.length === 2) {
    return { from: parts[0]!, to: parts[1]! };
  }
  return null;
}

interface SegmentHeaders {
  /** Paths from the `diff --git a/X b/Y` line, prefixes stripped. */
  gitFromPath: string | null;
  gitToPath: string | null;
  fromPath: string | null;
  toPath: string | null;
  copyFrom: string | null;
  copyTo: string | null;
  oldMode: string | null;
  newMode: string | null;
  binary: boolean;
}

function readSegmentHeaders(lines: readonly string[]): SegmentHeaders {
  const headers: SegmentHeaders = {
    gitFromPath: null,
    gitToPath: null,
    fromPath: null,
    toPath: null,
    copyFrom: null,
    copyTo: null,
    oldMode: null,
    newMode: null,
    binary: false,
  };
  const gitHeader = lines[0];
  if (gitHeader !== undefined && isFileHeaderLine(gitHeader)) {
    const gitPaths = parseGitHeaderPaths(gitHeader);
    headers.gitFromPath = gitPaths?.from ?? null;
    headers.gitToPath = gitPaths?.to ?? null;
  }
  for (const line of lines) {
    if (isHunkHeaderLine(line)) break;
    if (line.startsWith("--- ")) headers.fromPath = parseMarkerPath(line, "a/");
    else if (line.startsWith("+++ "))
      headers.toPath = parseMarkerPath(line, "b/");
    else if (line.startsWith("copy from ")) headers.copyFrom = line.slice(10);
    else if (line.startsWith("copy to ")) headers.copyTo = line.slice(8);
    else if (line.startsWith("old mode ")) headers.oldMode = line.slice(9);
    else if (line.startsWith("new mode ")) headers.newMode = line.slice(9);
    else if (line === BINARY_PATCH_LINE || BINARY_FILES_PATTERN.test(line))
      headers.binary = true;
  }
  return headers;
}

/**
 * Rewrites a file segment into the strict shape `parse-git-diff` accepts:
 * a leading `diff --git` line, no `GIT binary patch` body, and a space on
 * blank hunk lines.
 */
function normalizeSegment(
  lines: readonly string[],
  headers: SegmentHeaders,
): string[] {
  const out: string[] = [];
  let inHunk = false;
  let skippingBinaryBody = false;

  let body: readonly string[] = lines;
  if (!isFileHeaderLine(lines[0] ?? "")) {
    const fromPath =
      headers.fromPath && headers.fromPath !== DEV_NULL
        ? headers.fromPath
        : (headers.toPath ?? "");
    const toPath =
      headers.toPath && headers.toPath !== DEV_NULL
        ? headers.toPath
        : (headers.fromPath ?? "");
    out.push(`diff --git a/${fromPath} b/${toPath}`);
    // Anything before the `--- ` marker is prose, not patch.
    const markerIndex = lines.findIndex((line) => line.startsWith("--- "));
    if (markerIndex > 0) {
      body = lines.slice(markerIndex);
    }
  }

  for (const line of body) {
    if (skippingBinaryBody) continue;
    if (!inHunk && line === BINARY_PATCH_LINE) {
      // parse-git-diff only understands `Binary files … differ`; stand one
      // in for the binary body so the file still parses as binary.
      skippingBinaryBody = true;
      out.push(
        `Binary files a/${headers.gitFromPath ?? headers.fromPath ?? ""} and b/${headers.gitToPath ?? headers.toPath ?? ""} differ`,
      );
      continue;
    }
    if (isHunkHeaderLine(line)) {
      inHunk = true;
      out.push(line);
      continue;
    }
    if (inHunk && line === "") {
      out.push(" ");
      continue;
    }
    out.push(line);
  }
  return out;
}

function formatHunkHeader(chunk: AnyChunk): string {
  if (chunk.type === "BinaryFilesChunk") {
    return "";
  }
  const context = chunk.context ? ` ${chunk.context}` : "";
  if (chunk.type === "CombinedChunk") {
    return `@@@ -${chunk.fromFileRangeA.start},${chunk.fromFileRangeA.lines} -${chunk.fromFileRangeB.start},${chunk.fromFileRangeB.lines} +${chunk.toFileRange.start},${chunk.toFileRange.lines} @@@${context}`;
  }
  return `@@ -${chunk.fromFileRange.start},${chunk.fromFileRange.lines} +${chunk.toFileRange.start},${chunk.toFileRange.lines} @@${context}`;
}

function toDiffLine(change: AnyLineChange): DiffLine {
  switch (change.type) {
    case "AddedLine":
      return { type: "add", newNo: change.lineAfter, text: change.content };
    case "DeletedLine":
      return { type: "del", oldNo: change.lineBefore, text: change.content };
    case "UnchangedLine":
      return {
        type: "context",
        oldNo: change.lineBefore,
        newNo: change.lineAfter,
        text: change.content,
      };
    case "MessageLine":
      return { type: "meta", text: `\\ ${change.content}` };
  }
}

function toDiffHunk(chunk: AnyChunk): DiffHunk | null {
  if (chunk.type === "BinaryFilesChunk") {
    return null;
  }
  const fromRange =
    chunk.type === "CombinedChunk" ? chunk.fromFileRangeA : chunk.fromFileRange;
  return {
    header: formatHunkHeader(chunk),
    oldStart: fromRange.start,
    oldLines: fromRange.lines,
    newStart: chunk.toFileRange.start,
    newLines: chunk.toFileRange.lines,
    lines: chunk.changes.map(toDiffLine),
  };
}

function countStats(hunks: readonly DiffHunk[]): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions += 1;
      else if (line.type === "del") deletions += 1;
    }
  }
  return { additions, deletions };
}

function modeFileType(mode: string | null): string | null {
  // `100644` → `100` (regular), `120000` → `120` (symlink), `160000` → gitlink.
  return mode && mode.length >= 3 ? mode.slice(0, 3) : null;
}

function parseFileSegment(lines: readonly string[]): DiffFile | null {
  const headers = readSegmentHeaders(lines);
  const normalized = normalizeSegment(lines, headers);
  let parsed;
  try {
    parsed = parseGitDiff(normalized.join("\n"));
  } catch {
    return null;
  }
  const file = parsed.files[0];
  if (!file) {
    // parse-git-diff has no notion of copies: `copy from`/`copy to` with no
    // hunks yields nothing. Build the entry from the headers.
    if (headers.copyFrom !== null && headers.copyTo !== null) {
      return {
        path: headers.copyTo,
        previousPath: headers.copyFrom,
        changeKind: "copied",
        binary: headers.binary,
        hunks: [],
        stats: { additions: 0, deletions: 0 },
      };
    }
    return null;
  }

  const hunks: DiffHunk[] = [];
  let binary = headers.binary;
  for (const chunk of file.chunks) {
    if (chunk.type === "BinaryFilesChunk") {
      binary = true;
      continue;
    }
    const hunk = toDiffHunk(chunk);
    if (hunk) hunks.push(hunk);
  }

  let changeKind: DiffChangeKind;
  let path: string;
  let previousPath: string | null = null;

  if (file.type === "RenamedFile") {
    changeKind = "renamed";
    path = file.pathAfter;
    previousPath = file.pathBefore;
  } else if (headers.copyFrom !== null && headers.copyTo !== null) {
    changeKind = "copied";
    path = headers.copyTo;
    previousPath = headers.copyFrom;
  } else if (
    file.type === "AddedFile" ||
    (headers.fromPath === DEV_NULL && headers.toPath !== DEV_NULL)
  ) {
    changeKind = "added";
    path =
      headers.toPath && headers.toPath !== DEV_NULL
        ? headers.toPath
        : file.path;
  } else if (
    file.type === "DeletedFile" ||
    (headers.toPath === DEV_NULL && headers.fromPath !== DEV_NULL)
  ) {
    changeKind = "deleted";
    path =
      headers.fromPath && headers.fromPath !== DEV_NULL
        ? headers.fromPath
        : file.path;
  } else {
    const oldType = modeFileType(headers.oldMode);
    const newType = modeFileType(headers.newMode);
    changeKind =
      oldType !== null && newType !== null && oldType !== newType
        ? "type_changed"
        : "modified";
    path = file.path;
  }

  if (path.length === 0) {
    return null;
  }

  return {
    path,
    previousPath,
    changeKind,
    binary,
    hunks,
    stats: countStats(hunks),
  };
}

/**
 * Parses a unified diff (one or many files). Files whose segment cannot be
 * parsed are dropped; an empty `files` array means nothing was renderable and
 * the caller should fall back to plain text.
 */
export function parseUnifiedDiff(patch: string): ParsedDiff {
  const lines = splitDiffLines(patch);
  const files: DiffFile[] = [];
  for (const segment of splitFileSegments(lines)) {
    const file = parseFileSegment(segment);
    if (file) files.push(file);
  }
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.stats.additions;
    deletions += file.stats.deletions;
  }
  return { files, stats: { additions, deletions, files: files.length } };
}
