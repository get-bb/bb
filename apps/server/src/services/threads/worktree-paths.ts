import path from "node:path";
import { ApiError } from "../../errors.js";

const REPO_DIR_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

export function deriveRepoDirName(sourcePath: string): string {
  const trimmed = sourcePath.replace(/[\\/]+$/, "");

  const scpMatch = /^[^:/]+@[^:]+:(?<path>.+)$/.exec(trimmed);
  const remotePathPart = scpMatch?.groups?.path ?? tryParseUrlPath(trimmed);

  const basename =
    remotePathPart === null || remotePathPart === undefined
      ? localBasename(trimmed)
      : path.posix.basename(remotePathPart);
  const candidate = basename.endsWith(".git")
    ? basename.slice(0, -".git".length)
    : basename;

  if (
    !candidate ||
    candidate === "." ||
    candidate === ".." ||
    !REPO_DIR_NAME_PATTERN.test(candidate)
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `Cannot derive repository directory name from source "${sourcePath}"`,
    );
  }
  return candidate;
}

function localBasename(value: string): string {
  const lastSeparator = Math.max(
    value.lastIndexOf("/"),
    value.lastIndexOf("\\"),
  );
  return lastSeparator === -1 ? value : value.slice(lastSeparator + 1);
}

function tryParseUrlPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "ssh:"
    ) {
      return url.pathname;
    }
  } catch {}
  return null;
}

interface ResolveManagedTargetPathArgs {
  dataDir: string;
  environmentId: string;
  sourcePath: string;
}

interface ResolvePersonalTargetPathArgs {
  dataDir: string;
  environmentId: string;
}

export function resolveManagedTargetPath(
  args: ResolveManagedTargetPathArgs,
): string {
  return path.join(
    args.dataDir,
    "worktrees",
    args.environmentId,
    deriveRepoDirName(args.sourcePath),
  );
}

export function resolvePersonalTargetPath(
  args: ResolvePersonalTargetPathArgs,
): string {
  return path.join(
    args.dataDir,
    "personal-workspaces",
    args.environmentId,
  );
}

export function isBbManagedWorkspacePath(args: {
  dataDir: string;
  path: string;
}): boolean {
  return [
    path.join(args.dataDir, "worktrees"),
    path.join(args.dataDir, "personal-workspaces"),
  ].some((root) => {
    const relative = path.relative(root, args.path);
    if (relative === "") return true;
    if (path.isAbsolute(relative)) return false;
    return relative.split(path.sep)[0] !== "..";
  });
}
