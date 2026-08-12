import path from "node:path";
import { ApiError } from "../../errors.js";

const REPO_DIR_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

function toPosixSeparators(value: string): string {
  return value.replaceAll("\\", "/");
}

export function deriveRepoDirName(sourcePath: string): string {
  const trimmed = sourcePath.replace(/[\\/]+$/u, "");

  const scpMatch = /^[^:/]+@[^:]+:(?<path>.+)$/.exec(trimmed);
  const pathPart =
    scpMatch?.groups?.path ?? tryParseUrlPath(trimmed) ?? trimmed;

  const basename = path.posix.basename(toPosixSeparators(pathPart));
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
  } catch {
    // not a URL
  }
  return null;
}

export interface ResolveManagedTargetPathArgs {
  dataDir: string;
  environmentId: string;
  sourcePath: string;
}

export interface ResolvePersonalTargetPathArgs {
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
  return path.join(args.dataDir, "personal-workspaces", args.environmentId);
}

/**
 * Whether a path lies inside a workspace root bb creates and destroys on a
 * host. A managed environment stores its path only once the host reports
 * provisioning success, so an environment row is not a reliable claim during
 * that window. The roots are, because bb derives every managed path from them.
 */
export function isBbManagedWorkspacePath(args: {
  dataDir: string;
  path: string;
}): boolean {
  const candidate = toPosixSeparators(args.path);
  return [
    path.posix.join(toPosixSeparators(args.dataDir), "worktrees"),
    path.posix.join(toPosixSeparators(args.dataDir), "personal-workspaces"),
  ].some((root) => candidate === root || candidate.startsWith(`${root}/`));
}
