import {
  getHostPathDirname,
  isAbsoluteHostPath,
  isHostPathWithin,
  isWindowsHostPath,
  joinHostPath,
  normalizeHostPath,
} from "@bb/domain";

interface ResolveAbsoluteFilePathArgs {
  path: string;
  rootPath: string | null | undefined;
}

interface BuildAbsoluteFilePathArgs {
  path: string;
  rootPath: string;
}

interface GetAbsoluteDirnameArgs {
  path: string;
}

interface IsAbsoluteFilePathWithinRootArgs {
  candidatePath: string;
  rootPath: string;
}

interface NormalizeAbsoluteFilePathArgs {
  path: string;
}

function trimTrailingSlash(path: string): string {
  if (path === "/") {
    return path;
  }
  return path.replace(/\/+$/u, "");
}

function trimLeadingSlash(path: string): string {
  return path.replace(/^\/+/u, "");
}

function isAbsoluteFilePath(path: string): boolean {
  return isAbsoluteHostPath(path);
}

export function normalizeAbsoluteFilePath({
  path,
}: NormalizeAbsoluteFilePathArgs): string | null {
  return normalizeHostPath(path);
}

export function isAbsoluteFilePathWithinRoot({
  candidatePath,
  rootPath,
}: IsAbsoluteFilePathWithinRootArgs): boolean {
  return isHostPathWithin({ rootPath, candidatePath });
}

export function buildAbsoluteFilePath({
  path,
  rootPath,
}: BuildAbsoluteFilePathArgs): string {
  if (isAbsoluteFilePath(path)) {
    return path;
  }

  if (isWindowsHostPath(rootPath)) {
    return joinHostPath({ rootPath, relativePath: path }) ?? path;
  }

  const normalizedRootPath = trimTrailingSlash(rootPath);
  const relativePath = trimLeadingSlash(path);
  if (normalizedRootPath === "/") {
    return `/${relativePath}`;
  }
  return `${normalizedRootPath}/${relativePath}`;
}

export function resolveAbsoluteFilePath({
  path,
  rootPath,
}: ResolveAbsoluteFilePathArgs): string | null {
  if (isAbsoluteFilePath(path)) {
    return path;
  }
  if (!rootPath) {
    return null;
  }
  return buildAbsoluteFilePath({ path, rootPath });
}

export function getAbsoluteDirname({ path }: GetAbsoluteDirnameArgs): string {
  if (isWindowsHostPath(path)) {
    return getHostPathDirname(path) ?? path;
  }
  const trimmed = trimTrailingSlash(path);
  const lastSlashIndex = trimmed.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "/" : trimmed.slice(0, lastSlashIndex);
}
