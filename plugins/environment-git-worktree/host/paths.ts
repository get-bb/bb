import { WorkspaceError } from "bb-environment-provider-host/git";
import { createHash } from "node:crypto";
import path from "node:path";

const REPO_DIR_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;
const WINDOWS_RESERVED_NAME_PATTERN =
  /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_REPO_DIR_NAME_BYTES = 200;
const REPO_DIR_HASH_LENGTH = 16;

function invalidSourcePath(sourcePath: string): WorkspaceError {
  return new WorkspaceError(
    "invalid_source_path",
    `Cannot derive repository directory name from source "${sourcePath}"`,
  );
}

function sourcePathBasename(sourcePath: string): string {
  if (!sourcePath || CONTROL_CHARACTER_PATTERN.test(sourcePath)) {
    throw invalidSourcePath(sourcePath);
  }
  const pathApi = path.posix.isAbsolute(sourcePath)
    ? path.posix
    : path.win32.isAbsolute(sourcePath)
      ? path.win32
      : null;
  if (pathApi === null) {
    throw invalidSourcePath(sourcePath);
  }
  const trailingSeparators = pathApi === path.posix ? /\/+$/u : /[\\/]+$/u;
  return pathApi.basename(sourcePath.replace(trailingSeparators, ""));
}

function isSafeRepoDirName(candidate: string): boolean {
  return (
    candidate !== "." &&
    candidate !== ".." &&
    REPO_DIR_NAME_PATTERN.test(candidate) &&
    !candidate.endsWith(".") &&
    !WINDOWS_RESERVED_NAME_PATTERN.test(candidate) &&
    Buffer.byteLength(candidate, "utf8") <= MAX_REPO_DIR_NAME_BYTES
  );
}

function slugRepoDirName(candidate: string): string {
  const suffix = createHash("sha256")
    .update(candidate, "utf8")
    .digest("hex")
    .slice(0, REPO_DIR_HASH_LENGTH);
  const readableLimit = MAX_REPO_DIR_NAME_BYTES - suffix.length - 1;
  const normalizedReadable = candidate
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "");
  const readable = (
    WINDOWS_RESERVED_NAME_PATTERN.test(normalizedReadable)
      ? `repo-${normalizedReadable}`
      : normalizedReadable
  )
    .slice(0, readableLimit)
    .replace(/[._-]+$/u, "");
  return `${readable || "repo"}-${suffix}`;
}

export function deriveRepoDirName(sourcePath: string): string {
  const basename = sourcePathBasename(sourcePath);
  const candidate = basename.endsWith(".git")
    ? basename.slice(0, -".git".length)
    : basename;

  if (!candidate || candidate === "." || candidate === "..") {
    throw invalidSourcePath(sourcePath);
  }
  return isSafeRepoDirName(candidate) ? candidate : slugRepoDirName(candidate);
}

// bb-fork(windows): keep the data dir's own path convention. A native Windows
// data dir must not be joined with `/`, and a POSIX one must not use `\`.
function joinUnderDataDir(base: string, ...segments: string[]): string {
  const api =
    /^[A-Za-z]:[\\/]/u.test(base) || base.startsWith("\\\\")
      ? path.win32
      : path.posix;
  return api.join(base, ...segments);
}

// bb-fork(windows): the worktree root is under the local plugin data dir, so it
// must keep that dir's separators rather than always using `/`.
export function resolveWorktreesRoot(dataDir: string): string {
  return joinUnderDataDir(dataDir, "worktrees");
}

export function resolveWorktreeAttemptRoot(args: {
  dataDir: string;
  pathKey: string;
}): string {
  if (
    !args.pathKey ||
    args.pathKey === "." ||
    args.pathKey === ".." ||
    path.posix.basename(args.pathKey) !== args.pathKey ||
    path.win32.basename(args.pathKey) !== args.pathKey ||
    !REPO_DIR_NAME_PATTERN.test(args.pathKey)
  ) {
    throw new WorkspaceError(
      "invalid_path_key",
      "A worktree path key must be a single path segment",
    );
  }
  return joinUnderDataDir(resolveWorktreesRoot(args.dataDir), args.pathKey);
}

export function resolveWorktreeTargetPath(args: {
  dataDir: string;
  pathKey: string;
  sourcePath: string;
}): string {
  return joinUnderDataDir(
    resolveWorktreeAttemptRoot(args),
    deriveRepoDirName(args.sourcePath),
  );
}

export function resolveWorktreeChildPath(args: {
  dataDir: string;
  pathKey: string;
  childName: string;
}): string {
  if (
    args.childName === "." ||
    args.childName === ".." ||
    path.posix.basename(args.childName) !== args.childName ||
    !REPO_DIR_NAME_PATTERN.test(args.childName)
  ) {
    throw new WorkspaceError(
      "invalid_source_path",
      "A managed worktree directory name must be a safe path segment",
    );
  }
  return joinUnderDataDir(resolveWorktreeAttemptRoot(args), args.childName);
}
