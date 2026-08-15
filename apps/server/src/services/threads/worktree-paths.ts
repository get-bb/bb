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

export type HostPathKind = "posix" | "windows";

export interface ResolveManagedTargetPathArgs {
  dataDir: string;
  environmentId: string;
  sourcePath: string;
  hostPathKind: HostPathKind;
}

export interface ResolvePersonalTargetPathArgs {
  dataDir: string;
  environmentId: string;
  hostPathKind: HostPathKind;
}

function hostPath(kind: HostPathKind) {
  return kind === "windows" ? path.win32 : path.posix;
}

export function joinHostDataPath(rootPath: string, ...parts: string[]): string {
  return hostPath(hostPathKindFromDataDir(rootPath)).join(rootPath, ...parts);
}

export function hostPathKindFromPlatform(
  platform: string | null | undefined,
): HostPathKind {
  return platform === "win32" ? "windows" : "posix";
}

export function hostPathKindFromDataDir(dataDir: string): HostPathKind {
  return looksLikeWindowsPath(dataDir) ? "windows" : "posix";
}

export function resolveManagedTargetPath(
  args: ResolveManagedTargetPathArgs,
): string {
  return hostPath(args.hostPathKind).join(
    args.dataDir,
    "worktrees",
    args.environmentId,
    deriveRepoDirName(args.sourcePath),
  );
}

export function resolvePersonalTargetPath(
  args: ResolvePersonalTargetPathArgs,
): string {
  return hostPath(args.hostPathKind).join(
    args.dataDir,
    "personal-workspaces",
    args.environmentId,
  );
}

/**
 * Whether a path lies inside a workspace root bb creates and destroys on a
 * host. A managed environment stores its path only once the host reports
 * provisioning success, so an environment row is not a reliable claim during
 * that window. The roots are, because bb derives every managed path from them.
 */
function looksLikeWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || /^\\\\[^\\/]/u.test(value);
}

function collapsePosixPath(value: string, foldCase: boolean): string {
  const posix = toPosixSeparators(value);
  const driveMatch = /^([A-Za-z]:)(\/.*)?$/u.exec(posix);
  const prefix = driveMatch?.[1] ?? "";
  const rest = driveMatch ? (driveMatch[2] ?? "/") : posix;
  const collapsed: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (collapsed.length > 0) {
        collapsed.pop();
      }
      continue;
    }
    collapsed.push(segment);
  }
  const joined = prefix
    ? `${prefix}/${collapsed.join("/")}`
    : `/${collapsed.join("/")}`;
  return foldCase ? joined.toLowerCase() : joined;
}

export function isBbManagedWorkspacePath(args: {
  dataDir: string;
  path: string;
}): boolean {
  const foldCase =
    looksLikeWindowsPath(args.dataDir) || looksLikeWindowsPath(args.path);
  const candidate = collapsePosixPath(args.path, foldCase);
  return [
    collapsePosixPath(
      path.posix.join(toPosixSeparators(args.dataDir), "worktrees"),
      foldCase,
    ),
    collapsePosixPath(
      path.posix.join(toPosixSeparators(args.dataDir), "personal-workspaces"),
      foldCase,
    ),
  ].some((root) => candidate === root || candidate.startsWith(`${root}/`));
}
