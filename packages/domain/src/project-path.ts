const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:(?:[\\/]+)?$/u;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:(?:[\\/]+)/u;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\/]+(?:[\\/]+)[^\\/]+/u;

export const INVALID_PROJECT_PATH_MESSAGE =
  "Project path must be an absolute path.";
export const PROJECT_PATH_ROOT_MESSAGE =
  "Project path must point to a project directory, not the filesystem root.";

const WINDOWS_UNC_SHARE_ROOT_PATTERN = /^\\\\[^\\/]+[\\/]+[^\\/]+[\\/]*$/u;

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

export function isAbsoluteProjectPath(path: string): boolean {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return false;
  }

  return trimmedPath.startsWith("/") || isNativeWindowsProjectPath(trimmedPath);
}

function isProjectPathRoot(path: string): boolean {
  if (path === "/") {
    return true;
  }
  if (WINDOWS_DRIVE_ROOT_PATTERN.test(path)) {
    return true;
  }
  return WINDOWS_UNC_SHARE_ROOT_PATTERN.test(path);
}

export function normalizeProjectPathInput(path: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "";
  }

  if (trimmedPath === "/") {
    return trimmedPath;
  }

  if (WINDOWS_DRIVE_ROOT_PATTERN.test(trimmedPath)) {
    return `${trimmedPath[0]}:\\`;
  }

  return trimmedPath.replace(/[\\/]+$/u, "");
}

export function getProjectPathValidationMessage(path: string): string | null {
  const normalizedPath = normalizeProjectPathInput(path);
  if (!normalizedPath) {
    return INVALID_PROJECT_PATH_MESSAGE;
  }
  if (!isAbsoluteProjectPath(normalizedPath)) {
    return INVALID_PROJECT_PATH_MESSAGE;
  }
  if (isProjectPathRoot(normalizedPath)) {
    return PROJECT_PATH_ROOT_MESSAGE;
  }
  return null;
}

export function deriveProjectNameFromPath(path: string): string {
  const normalizedPath = normalizeProjectPathInput(path);
  if (!normalizedPath || getProjectPathValidationMessage(normalizedPath)) {
    return "";
  }

  const segments = normalizedPath.replaceAll("\\", "/").split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}
