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

function isWindowsUncPath(path: string): boolean {
  return /^\\\\[^\\/]/u.test(path);
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(path);
}

function isWindowsAbsoluteFilePath(path: string): boolean {
  return isWindowsDrivePath(path) || isWindowsUncPath(path);
}

export function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || isWindowsAbsoluteFilePath(path);
}

function trimTrailingSlash(path: string): string {
  if (path === "/" || /^[A-Za-z]:\\$/u.test(path) || /^\\\\[^\\]+\\[^\\]+\\?$/u.test(path)) {
    return path.replace(/\\$/u, (match) => (path.length === 3 ? match : ""));
  }
  return path.replace(/[\\/]+$/u, "");
}

function trimLeadingSlash(path: string): string {
  return path.replace(/^[\\/]+/u, "");
}

export function normalizeAbsoluteFilePath({
  path,
}: NormalizeAbsoluteFilePathArgs): string | null {
  if (!isAbsoluteFilePath(path)) {
    return null;
  }

  if (isWindowsUncPath(path)) {
    const segments = path.split(/[\\/]/u).filter((segment) => segment.length > 0);
    if (segments.length < 2) {
      return null;
    }
    const share = [segments[0], segments[1]];
    const rest: string[] = [];
    for (const segment of segments.slice(2)) {
      if (segment === ".") {
        continue;
      }
      if (segment === "..") {
        if (rest.length > 0) {
          rest.pop();
        }
        continue;
      }
      rest.push(segment);
    }
    return `\\\\${[...share, ...rest].join("\\")}`;
  }

  if (isWindowsDrivePath(path)) {
    const drive = `${path[0]!.toUpperCase()}:`;
    const rest: string[] = [];
    for (const segment of path.slice(2).split(/[\\/]/u)) {
      if (segment.length === 0 || segment === ".") {
        continue;
      }
      if (segment === "..") {
        if (rest.length > 0) {
          rest.pop();
        }
        continue;
      }
      rest.push(segment);
    }
    return rest.length === 0 ? `${drive}\\` : `${drive}\\${rest.join("\\")}`;
  }

  const posixSegments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (posixSegments.length > 0) {
        posixSegments.pop();
      }
      continue;
    }
    posixSegments.push(segment);
  }
  return posixSegments.length === 0 ? "/" : `/${posixSegments.join("/")}`;
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

  const windowsRoot = isWindowsAbsoluteFilePath(normalizedRootPath);
  const candidateKey = windowsRoot
    ? normalizedCandidatePath.toLowerCase()
    : normalizedCandidatePath;
  const rootKey = windowsRoot
    ? trimTrailingSlash(normalizedRootPath).toLowerCase()
    : trimTrailingSlash(normalizedRootPath);
  const separator = windowsRoot ? "\\" : "/";
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${separator}`);
}

export function buildAbsoluteFilePath({
  path,
  rootPath,
}: BuildAbsoluteFilePathArgs): string {
  if (isAbsoluteFilePath(path)) {
    return path;
  }

  const normalizedRoot =
    normalizeAbsoluteFilePath({ path: rootPath }) ?? trimTrailingSlash(rootPath);
  const relativePath = trimLeadingSlash(path);
  if (normalizedRoot === "/") {
    return `/${relativePath}`;
  }
  if (isWindowsAbsoluteFilePath(normalizedRoot)) {
    return `${trimTrailingSlash(normalizedRoot)}\\${relativePath.replaceAll("/", "\\")}`;
  }
  return `${normalizedRoot}/${relativePath}`;
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
  const normalized = normalizeAbsoluteFilePath({ path });
  if (normalized === null) {
    return "/";
  }
  if (normalized === "/" || /^[A-Za-z]:\\$/u.test(normalized)) {
    return normalized;
  }
  if (isWindowsUncPath(normalized)) {
    const parts = normalized.split("\\").filter((part) => part.length > 0);
    if (parts.length <= 2) {
      return normalized;
    }
    return `\\\\${parts.slice(0, -1).join("\\")}`;
  }
  const separator = isWindowsDrivePath(normalized) ? "\\" : "/";
  const lastSlashIndex = normalized.lastIndexOf(separator);
  if (lastSlashIndex <= 0) {
    return isWindowsDrivePath(normalized) ? `${normalized.slice(0, 2)}\\` : "/";
  }
  const parent = normalized.slice(0, lastSlashIndex);
  return parent === "" || /^[A-Za-z]:$/u.test(parent) ? `${parent}\\` : parent;
}
