import type { FilePreviewLineRange } from "@bb/client-core";

/**
 * Routing for an absolute local file path tapped in markdown or an attachment
 * (port of apps/app/src/lib/thread-local-file-links.ts + absolute-file-path.ts):
 * inside the workspace root → a workspace (worktree) file, inside the thread
 * storage root → a storage file, otherwise a host file read through the
 * thread's host. Pure and vitest-tested.
 */

export function normalizeAbsoluteFilePath(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

function isAbsoluteFilePathWithinRoot(
  candidatePath: string,
  rootPath: string,
): boolean {
  const candidate = normalizeAbsoluteFilePath(candidatePath);
  const root = normalizeAbsoluteFilePath(rootPath);
  if (candidate === null || root === null) return false;
  if (root === "/") return true;
  return candidate === root || candidate.startsWith(`${root}/`);
}

export interface LocalFilePathWithinRoot {
  path: string;
  relativePath: string;
  rootPath: string;
}

/** Normalized path + its root-relative part, or null when outside (or equal to) the root. */
export function relativizeLocalFilePath(
  linkPath: string,
  rootPath: string,
): LocalFilePathWithinRoot | null {
  const root = normalizeAbsoluteFilePath(rootPath);
  const path = normalizeAbsoluteFilePath(linkPath);
  if (root === null || path === null) return null;
  if (!isAbsoluteFilePathWithinRoot(path, root) || path === root) return null;
  return {
    path,
    relativePath: root === "/" ? path.slice(1) : path.slice(root.length + 1),
    rootPath: root,
  };
}

export interface ResolveThreadLocalFileLinkArgs {
  path: string;
  lineRange: FilePreviewLineRange | null;
  /** The environment's checkout path (null until the bootstrap loads). */
  workspaceRootPath: string | null;
  /** `storageRootPath` from the storage file list (null until loaded). */
  threadStorageRootPath: string | null;
  /** Host-file reads need the thread to have an environment (its host). */
  hostFileLinksAvailable: boolean;
}

export type ThreadLocalFileLinkResolution =
  | { kind: "error"; description: string }
  | {
      kind: "workspace-file";
      relativePath: string;
      path: string;
      lineRange: FilePreviewLineRange | null;
    }
  | {
      kind: "storage-file";
      relativePath: string;
      path: string;
      lineRange: FilePreviewLineRange | null;
    }
  | { kind: "host-file"; path: string; lineRange: FilePreviewLineRange | null };

const THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION =
  "Thread file links are only available when the thread has an environment.";
const THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION =
  "Thread file links must use absolute file paths.";

/** Workspace root first, then thread storage, then the host (web order). */
export function resolveThreadLocalFileLink(
  args: ResolveThreadLocalFileLinkArgs,
): ThreadLocalFileLinkResolution {
  const normalizedPath = normalizeAbsoluteFilePath(args.path);
  if (normalizedPath === null) {
    return {
      kind: "error",
      description: THREAD_LOCAL_FILE_LINK_INVALID_PATH_DESCRIPTION,
    };
  }
  const workspace =
    args.workspaceRootPath === null
      ? null
      : relativizeLocalFilePath(normalizedPath, args.workspaceRootPath);
  if (workspace) {
    return {
      kind: "workspace-file",
      relativePath: workspace.relativePath,
      path: workspace.path,
      lineRange: args.lineRange,
    };
  }
  const storage =
    args.threadStorageRootPath === null
      ? null
      : relativizeLocalFilePath(normalizedPath, args.threadStorageRootPath);
  if (storage) {
    return {
      kind: "storage-file",
      relativePath: storage.relativePath,
      path: storage.path,
      lineRange: args.lineRange,
    };
  }
  if (!args.hostFileLinksAvailable) {
    return {
      kind: "error",
      description: THREAD_LOCAL_FILE_LINK_UNAVAILABLE_DESCRIPTION,
    };
  }
  return { kind: "host-file", path: normalizedPath, lineRange: args.lineRange };
}

/**
 * A relative `path[:line]` reference (a markdown link without a scheme or a
 * leading slash, or a bare `src/foo.ts:12` code span) that could live under
 * either root. Returns the candidate roots the user can pick from.
 */
export interface RelativeFileLinkCandidate {
  kind: "workspace-file" | "storage-file";
  relativePath: string;
  rootPath: string;
}

const RELATIVE_FILE_PATH_PATTERN =
  /^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/)(?!#)[^\s<>"'`]+$/u;

export function isRelativeFilePathCandidate(value: string): boolean {
  if (!RELATIVE_FILE_PATH_PATTERN.test(value)) return false;
  const basename = value.split("/").at(-1) ?? "";
  return basename.includes(".") || value.includes("/");
}

export function relativeFileLinkCandidates(args: {
  relativePath: string;
  workspaceRootPath: string | null;
  threadStorageRootPath: string | null;
}): RelativeFileLinkCandidate[] {
  const cleaned = args.relativePath.replace(/^\.\//u, "");
  if (cleaned.length === 0 || cleaned.split("/").includes("..")) return [];
  const candidates: RelativeFileLinkCandidate[] = [];
  if (args.workspaceRootPath !== null) {
    candidates.push({
      kind: "workspace-file",
      relativePath: cleaned,
      rootPath: args.workspaceRootPath,
    });
  }
  if (args.threadStorageRootPath !== null) {
    candidates.push({
      kind: "storage-file",
      relativePath: cleaned,
      rootPath: args.threadStorageRootPath,
    });
  }
  return candidates;
}

/**
 * Resolve a relative link (`../img/a.png`, `./b.md`, `c.md`) against the
 * directory of the previewed file. Root-relative bases ("" or `docs`) stay
 * root-relative and return null when the link escapes the root; absolute
 * bases (`/home/u/docs`) stay absolute. A `path#fragment` / `path:line`
 * suffix must be stripped by the caller first.
 */
export function resolveRelativeLink(
  baseDirectory: string,
  relativePath: string,
): string | null {
  const absolute = baseDirectory.startsWith("/");
  const segments = baseDirectory.split("/").filter((s) => s.length > 0);
  for (const segment of relativePath.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  return absolute ? `/${segments.join("/")}` : segments.join("/");
}
