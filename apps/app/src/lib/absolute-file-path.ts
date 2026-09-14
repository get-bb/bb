const WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u; // bb-fork(windows)

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

interface NormalizeSegmentsArgs {
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

function toForwardSlashPath(path: string): string {
  return path.includes("\\") ? path.replace(/\\/g, "/") : path;
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.test(path);
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:($|\/)/u.test(path);
}

function normalizeSegments({ path }: NormalizeSegmentsArgs): string[] {
  const normalizedSegments: string[] = [];
  for (const segment of path.split("/")) {
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
  return normalizedSegments;
}

export function normalizeAbsoluteFilePath({
  path,
}: NormalizeAbsoluteFilePathArgs): string | null {
  if (!isAbsoluteFilePath(path)) {
    return null;
  }

  const slashPath = toForwardSlashPath(path);
  if (slashPath.startsWith("/")) {
    const normalizedSegments = normalizeSegments({ path: slashPath });
    return normalizedSegments.length === 0
      ? "/"
      : `/${normalizedSegments.join("/")}`;
  }

  const drive = slashPath[0]!.toLowerCase();
  const normalizedSegments = normalizeSegments({
    path: slashPath.slice(3),
  });
  return normalizedSegments.length === 0
    ? `${drive}:`
    : `${drive}:/${normalizedSegments.join("/")}`;
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

  if (
    isWindowsDrivePath(normalizedRootPath) &&
    isWindowsDrivePath(normalizedCandidatePath)
  ) {
    const candidate = normalizedCandidatePath.toLowerCase();
    const root = normalizedRootPath.toLowerCase();
    return candidate === root || candidate.startsWith(`${root}/`);
  }

  return (
    normalizedCandidatePath === normalizedRootPath ||
    normalizedCandidatePath.startsWith(`${normalizedRootPath}/`)
  );
}

export function buildAbsoluteFilePath({
  path,
  rootPath,
}: BuildAbsoluteFilePathArgs): string {
  if (isAbsoluteFilePath(path)) {
    return path;
  }

  const normalizedRootPath = trimTrailingSlash(toForwardSlashPath(rootPath));
  const relativePath = trimLeadingSlash(toForwardSlashPath(path));
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
  const slashPath = toForwardSlashPath(path);
  const trimmed = slashPath === "/" ? slashPath : trimTrailingSlash(slashPath);
  if (!trimmed.includes("/")) {
    return /^[A-Za-z]:$/u.test(trimmed) ? trimmed : "/";
  }
  const lastSlashIndex = trimmed.lastIndexOf("/");
  if (lastSlashIndex === 0) {
    return "/";
  }
  return trimmed.slice(0, lastSlashIndex);
}
