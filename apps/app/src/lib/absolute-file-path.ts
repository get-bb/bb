export interface ResolveAbsoluteFilePathArgs {
  path: string;
  rootPath: string | null | undefined;
}

export interface BuildAbsoluteFilePathArgs {
  path: string;
  rootPath: string;
}

export interface GetAbsoluteDirnameArgs {
  path: string;
}

export interface IsAbsoluteFilePathWithinRootArgs {
  candidatePath: string;
  rootPath: string;
}

export interface NormalizeAbsoluteFilePathArgs {
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

function isWindowsAbsoluteFilePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(path) || /^\\\\[^\\/]/u.test(path);
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsoluteFilePath(path);
}

export function normalizeAbsoluteFilePath({
  path,
}: NormalizeAbsoluteFilePathArgs): string | null {
  if (!isAbsoluteFilePath(path)) {
    return null;
  }

  const windowsAbsolute = isWindowsAbsoluteFilePath(path);
  const separator = windowsAbsolute && path.includes("\\") ? "\\" : "/";
  const normalizedSegments: string[] = [];
  for (const segment of path.split(/[\\/]/u)) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (normalizedSegments.length > 0) {
        normalizedSegments.pop();
      }
      continue;
    }
    normalizedSegments.push(segment);
  }

  if (windowsAbsolute) {
    if (path.startsWith("\\\\")) {
      return `\\\\${normalizedSegments.join(separator)}`;
    }
    return normalizedSegments.join(separator);
  }

  return normalizedSegments.length === 0
    ? "/"
    : `/${normalizedSegments.join("/")}`;
}

export function isAbsoluteFilePathWithinRoot({
  candidatePath,
  rootPath,
}: IsAbsoluteFilePathWithinRootArgs): boolean {
  const normalizedCandidatePath = normalizeAbsoluteFilePath({
    path: candidatePath,
  });
  const normalizedRootPath = normalizeAbsoluteFilePath({ path: rootPath });
  if (normalizedCandidatePath === null || normalizedRootPath === null) {
    return false;
  }

  if (normalizedRootPath === "/") {
    return normalizedCandidatePath.startsWith("/");
  }

  return (
    normalizedCandidatePath === normalizedRootPath ||
    normalizedCandidatePath.startsWith(`${normalizedRootPath}/`) ||
    normalizedCandidatePath.startsWith(`${normalizedRootPath}\\`)
  );
}

export function buildAbsoluteFilePath({
  path,
  rootPath,
}: BuildAbsoluteFilePathArgs): string {
  if (isAbsoluteFilePath(path)) {
    return path;
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

/**
 * Parent directory of an absolute path, used as the base for resolving relative
 * links inside a previewed file. Returns the filesystem root for top-level paths.
 */
export function getAbsoluteDirname({ path }: GetAbsoluteDirnameArgs): string {
  const trimmed = trimTrailingSlash(path);
  const lastSlashIndex = trimmed.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "/" : trimmed.slice(0, lastSlashIndex);
}
