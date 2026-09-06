type HostPathFlavor = "posix" | "windows";

const WINDOWS_DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_ABSOLUTE_PATTERN = /^\\\\[^\\/]+[\\/]+[^\\/]+/u;
const WINDOWS_EXTENDED_PREFIX_PATTERN = /^\\\\[?.]\\/u;
const WINDOWS_ROOTED_PATTERN = /^\\/u;
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Z]:\\$/u;
const WINDOWS_UNC_ROOT_PATTERN = /^\\\\[^\\]+\\[^\\]+$/u;

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

function detectHostPathFlavor(path: string): HostPathFlavor | null {
  if (path.startsWith("/")) {
    return "posix";
  }
  if (
    WINDOWS_DRIVE_ABSOLUTE_PATTERN.test(path) ||
    WINDOWS_UNC_ABSOLUTE_PATTERN.test(path) ||
    WINDOWS_EXTENDED_PREFIX_PATTERN.test(path) ||
    WINDOWS_ROOTED_PATTERN.test(path)
  ) {
    return "windows";
  }
  return null;
}

export function isWindowsAbsoluteFilePath(path: string): boolean {
  return detectHostPathFlavor(path) === "windows";
}

export function isAbsoluteFilePath(path: string): boolean {
  return detectHostPathFlavor(path) !== null;
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

function trimTrailingBackslash(path: string): string {
  return path.replace(/\\+$/u, "");
}

function isWindowsRootPath(path: string): boolean {
  return (
    path === "\\" ||
    WINDOWS_DRIVE_ROOT_PATTERN.test(path) ||
    WINDOWS_UNC_ROOT_PATTERN.test(path) ||
    WINDOWS_EXTENDED_PREFIX_PATTERN.test(path)
  );
}

function resolveDotSegments(segments: string[]): string[] {
  const normalizedSegments: string[] = [];
  for (const segment of segments) {
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

function normalizeWindowsFilePath(path: string): string | null {
  const unified = path.replace(/\//gu, "\\");
  const extendedMatch = /^\\\\([?.])\\/u.exec(unified);
  const prefix = extendedMatch ? `\\\\${extendedMatch[1]}\\` : "";
  const remainder = extendedMatch ? unified.slice(prefix.length) : unified;
  if (remainder.length === 0) {
    return prefix === "" ? null : prefix;
  }

  const driveMatch = /^([A-Za-z]):\\/u.exec(remainder);
  if (driveMatch) {
    const segments = resolveDotSegments(remainder.slice(3).split("\\"));
    return segments.length === 0
      ? `${prefix}${driveMatch[1].toUpperCase()}:\\`
      : `${prefix}${driveMatch[1].toUpperCase()}:\\${segments.join("\\")}`;
  }

  if (remainder.startsWith("\\\\")) {
    const segments = resolveDotSegments(remainder.split("\\"));
    if (segments.length < 2) {
      return null;
    }
    return `${prefix}\\\\${segments.join("\\")}`;
  }

  if (remainder.startsWith("\\")) {
    const segments = resolveDotSegments(remainder.split("\\"));
    return segments.length === 0 ? `${prefix}\\` : `${prefix}\\${segments.join("\\")}`;
  }

  return null;
}

function normalizePosixFilePath(path: string): string | null {
  if (!path.startsWith("/")) {
    return null;
  }

  const normalizedSegments = resolveDotSegments(path.split("/"));

  return normalizedSegments.length === 0
    ? "/"
    : `/${normalizedSegments.join("/")}`;
}

export function normalizeAbsoluteFilePath({
  path,
}: NormalizeAbsoluteFilePathArgs): string | null {
  const flavor = detectHostPathFlavor(path);
  if (flavor === "windows") {
    return normalizeWindowsFilePath(path);
  }
  return normalizePosixFilePath(path);
}

function windowsRootWithSeparator(rootPath: string): string {
  return rootPath.endsWith("\\") ? rootPath : `${rootPath}\\`;
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

  const candidateIsWindows =
    isWindowsAbsoluteFilePath(normalizedCandidatePath) ||
    isWindowsRootPath(normalizedCandidatePath);
  const rootIsWindows =
    isWindowsAbsoluteFilePath(normalizedRootPath) ||
    isWindowsRootPath(normalizedRootPath);
  if (candidateIsWindows !== rootIsWindows) {
    return false;
  }
  if (rootIsWindows) {
    const loweredCandidate = normalizedCandidatePath.toLowerCase();
    const loweredRoot = normalizedRootPath.toLowerCase();
    return (
      loweredCandidate === loweredRoot ||
      loweredCandidate.startsWith(windowsRootWithSeparator(loweredRoot))
    );
  }

  if (normalizedRootPath === "/") {
    return normalizedCandidatePath.startsWith("/");
  }

  return (
    normalizedCandidatePath === normalizedRootPath ||
    normalizedCandidatePath.startsWith(`${normalizedRootPath}/`)
  );
}

function buildWindowsFilePath(rootPath: string, relativePath: string): string {
  const normalizedRootPath = trimTrailingBackslash(rootPath);
  const unifiedRelativePath = relativePath
    .replace(/\//gu, "\\")
    .replace(/^\\+/u, "");
  if (normalizedRootPath === "" || normalizedRootPath === "\\") {
    return `\\${unifiedRelativePath}`;
  }
  if (/^[A-Za-z]:$/u.test(normalizedRootPath)) {
    return `${normalizedRootPath}\\${unifiedRelativePath}`;
  }
  return `${normalizedRootPath}\\${unifiedRelativePath}`;
}

export function buildAbsoluteFilePath({
  path,
  rootPath,
}: BuildAbsoluteFilePathArgs): string {
  if (isAbsoluteFilePath(path)) {
    return path;
  }

  if (isWindowsAbsoluteFilePath(rootPath)) {
    return buildWindowsFilePath(rootPath, path);
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

function getWindowsDirname(path: string): string {
  const normalized = normalizeWindowsFilePath(path);
  if (normalized === null) {
    return path;
  }
  if (isWindowsRootPath(normalized)) {
    return normalized;
  }
  const trimmed = trimTrailingBackslash(normalized);
  const lastSeparatorIndex = trimmed.lastIndexOf("\\");
  if (lastSeparatorIndex <= 0) {
    return "\\";
  }
  const parent = trimmed.slice(0, lastSeparatorIndex);
  if (/^[A-Za-z]:$/u.test(parent)) {
    return `${parent}\\`;
  }
  if (parent === "\\") {
    return parent;
  }
  const uncRootMatch = /^\\\\[^\\]+\\[^\\]+$/u.exec(parent);
  if (uncRootMatch) {
    return parent;
  }
  return parent;
}

export function getAbsoluteDirname({ path }: GetAbsoluteDirnameArgs): string {
  if (isWindowsAbsoluteFilePath(path)) {
    return getWindowsDirname(path);
  }
  const trimmed = trimTrailingSlash(path);
  const lastSlashIndex = trimmed.lastIndexOf("/");
  return lastSlashIndex <= 0 ? "/" : trimmed.slice(0, lastSlashIndex);
}
