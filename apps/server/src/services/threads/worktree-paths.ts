import path from "node:path";
import { ApiError } from "../../errors.js";

const REPO_DIR_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

export function deriveRepoDirName(sourcePath: string): string {
  const trimmed = sourcePath.replace(/\/+$/, "");

  const scpMatch = /^[^:/]+@[^:]+:(?<path>.+)$/.exec(trimmed);
  const pathPart =
    scpMatch?.groups?.path ?? tryParseUrlPath(trimmed) ?? trimmed;

  const basename = path.posix.basename(pathPart);
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

export type ResolveIsolatedScratchTargetPathArgs =
  ResolvePersonalTargetPathArgs;

export type ResolveDetachedReadOnlyPathArgs = ResolveManagedTargetPathArgs;

export type ResolveDetachedReadOnlyOutputPathArgs =
  ResolvePersonalTargetPathArgs;

export function resolveManagedTargetPath(
  args: ResolveManagedTargetPathArgs,
): string {
  return path.posix.join(
    args.dataDir,
    "worktrees",
    args.environmentId,
    deriveRepoDirName(args.sourcePath),
  );
}

export function resolvePersonalTargetPath(
  args: ResolvePersonalTargetPathArgs,
): string {
  return path.posix.join(
    args.dataDir,
    "personal-workspaces",
    args.environmentId,
  );
}

export function resolveIsolatedScratchTargetPath(
  args: ResolveIsolatedScratchTargetPathArgs,
): string {
  return path.posix.join(
    args.dataDir,
    "isolated-scratch-workspaces",
    args.environmentId,
  );
}

export function resolveDetachedReadOnlyTargetPath(
  args: ResolveDetachedReadOnlyPathArgs,
): string {
  return path.posix.join(
    args.dataDir,
    "detached-read-only-workspaces",
    args.environmentId,
    deriveRepoDirName(args.sourcePath),
  );
}

export function resolveDetachedReadOnlyOutputPath(
  args: ResolveDetachedReadOnlyOutputPathArgs,
): string {
  return path.posix.join(
    args.dataDir,
    "detached-read-only-outputs",
    args.environmentId,
  );
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
  return [
    path.posix.join(args.dataDir, "worktrees"),
    path.posix.join(args.dataDir, "personal-workspaces"),
    path.posix.join(args.dataDir, "isolated-scratch-workspaces"),
    path.posix.join(args.dataDir, "detached-read-only-workspaces"),
    path.posix.join(args.dataDir, "detached-read-only-outputs"),
  ].some((root) => args.path === root || args.path.startsWith(`${root}/`));
}
