export type ProjectPathPlatform =
  | "aix"
  | "android"
  | "darwin"
  | "freebsd"
  | "haiku"
  | "linux"
  | "openbsd"
  | "sunos"
  | "win32"
  | "cygwin"
  | "netbsd";

const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:(?:[\\/]+)?$/u;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:(?:[\\/]+)/u;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\/]+(?:[\\/]+)[^\\/]+/u;
const WINDOWS_EXTENDED_LENGTH_PREFIX_PATTERN = /^\\\\[?.]\\/u;
const WINDOWS_DRIVE_PATH_PATTERN = /^[A-Za-z]:(?:[\\/]|$)/u;
const WINDOWS_UNC_ABSOLUTE_PATTERN = /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/u;
const WINDOWS_EXTENDED_ABSOLUTE_PATTERN = /^\\\\[?.]\\[\s\S]+/u;
const WINDOWS_DRIVE_ROOT_CANONICAL_PATTERN = /^[A-Z]:\\$/u;
const WINDOWS_UNC_ROOT_CANONICAL_PATTERN = /^\\\\[^\\]+\\[^\\]+$/u;
const WINDOWS_EXTENDED_UNC_ROOT_PATTERN =
  /^[Uu][Nn][Cc][\\/][^\\/]+[\\/][^\\/]+[\\/]*$/u;

export const INVALID_PROJECT_PATH_MESSAGE =
  "Project path must be an absolute path.";
export const PROJECT_PATH_ROOT_MESSAGE =
  "Project path must point to a project directory, not the filesystem root.";

export function isNativeWindowsProjectPath(path: string): boolean {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return false;
  }

  return (
    WINDOWS_DRIVE_ROOT_PATTERN.test(trimmedPath) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(trimmedPath) ||
    WINDOWS_UNC_PATH_PATTERN.test(trimmedPath)
  );
}

export function isAbsoluteProjectPath(
  path: string,
  platform: ProjectPathPlatform,
): boolean {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return false;
  }

  if (platform !== "win32") {
    return trimmedPath.startsWith("/");
  }

  return (
    WINDOWS_DRIVE_PATH_PATTERN.test(trimmedPath) ||
    WINDOWS_UNC_ABSOLUTE_PATTERN.test(trimmedPath) ||
    WINDOWS_EXTENDED_ABSOLUTE_PATTERN.test(trimmedPath)
  );
}

export function normalizeProjectPathInput(
  path: string,
  platform: ProjectPathPlatform,
): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "";
  }

  if (platform !== "win32") {
    if (trimmedPath === "/") {
      return trimmedPath;
    }

    return trimmedPath.replace(/\/+$/u, "");
  }

  if (WINDOWS_EXTENDED_LENGTH_PREFIX_PATTERN.test(trimmedPath)) {
    return trimmedPath;
  }

  const unifiedPath = trimmedPath.replace(/\//gu, "\\");
  const driveMatch = /^([A-Za-z]):(?=[\\/]|$)/u.exec(unifiedPath);
  if (driveMatch) {
    const drivePrefix = `${driveMatch[1].toUpperCase()}:`;
    const restSegments = unifiedPath.slice(2).split(/\\+/u).filter(Boolean);
    if (restSegments.length === 0) {
      return `${drivePrefix}\\`;
    }
    return `${drivePrefix}\\${restSegments.join("\\")}`;
  }

  if (unifiedPath.startsWith("\\\\")) {
    const uncSegments = unifiedPath.split(/\\+/u).filter(Boolean);
    if (uncSegments.length === 0) {
      return "\\\\";
    }
    return `\\\\${uncSegments.join("\\")}`;
  }

  return unifiedPath.replace(/\\+$/u, "");
}

function isWindowsRootPath(normalizedPath: string): boolean {
  if (WINDOWS_EXTENDED_LENGTH_PREFIX_PATTERN.test(normalizedPath)) {
    const remainder = normalizedPath.replace(
      WINDOWS_EXTENDED_LENGTH_PREFIX_PATTERN,
      "",
    );
    return (
      WINDOWS_DRIVE_ROOT_PATTERN.test(remainder) ||
      WINDOWS_EXTENDED_UNC_ROOT_PATTERN.test(remainder)
    );
  }

  return (
    WINDOWS_DRIVE_ROOT_CANONICAL_PATTERN.test(normalizedPath) ||
    WINDOWS_UNC_ROOT_CANONICAL_PATTERN.test(normalizedPath)
  );
}

function isRootProjectPath(
  normalizedPath: string,
  platform: ProjectPathPlatform,
): boolean {
  if (platform === "win32") {
    return isWindowsRootPath(normalizedPath);
  }

  return normalizedPath === "/";
}

export function getProjectPathValidationMessage(
  path: string,
  platform: ProjectPathPlatform,
): string | null {
  const normalizedPath = normalizeProjectPathInput(path, platform);
  if (!normalizedPath) {
    return INVALID_PROJECT_PATH_MESSAGE;
  }
  if (!isAbsoluteProjectPath(normalizedPath, platform)) {
    return INVALID_PROJECT_PATH_MESSAGE;
  }
  if (isRootProjectPath(normalizedPath, platform)) {
    return PROJECT_PATH_ROOT_MESSAGE;
  }
  return null;
}

export function deriveProjectNameFromPath(
  path: string,
  platform: ProjectPathPlatform,
): string {
  const normalizedPath = normalizeProjectPathInput(path, platform);
  if (
    !normalizedPath ||
    !isAbsoluteProjectPath(normalizedPath, platform) ||
    isRootProjectPath(normalizedPath, platform)
  ) {
    return "";
  }

  if (platform === "win32") {
    const segments = normalizedPath.split(/[\\/]+/u).filter(Boolean);
    return segments.at(-1) ?? "";
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}

export function isSameProjectPath(
  a: string,
  b: string,
  platform: ProjectPathPlatform,
): boolean {
  const normalizedA = normalizeProjectPathInput(a, platform);
  const normalizedB = normalizeProjectPathInput(b, platform);
  if (!normalizedA || !normalizedB) {
    return false;
  }

  if (platform === "win32") {
    return normalizedA.toLowerCase() === normalizedB.toLowerCase();
  }

  return normalizedA === normalizedB;
}
