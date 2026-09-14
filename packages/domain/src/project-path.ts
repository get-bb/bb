// bb-fork(windows): drive/UNC helpers live in a fork module.
import {
  deriveWindowsProjectName,
  isWindowsFilesystemRoot,
} from "./project-path-windows.js";

const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:(?:[\\/]+)?$/u;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:(?:[\\/]+)/u;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\/]+(?:[\\/]+)[^\\/]+/u;

export const INVALID_PROJECT_PATH_MESSAGE =
  "Project path must be an absolute path.";
export const PROJECT_PATH_ROOT_MESSAGE =
  "Project path must point to a project directory, not the filesystem root.";
// bb-fork(windows): kept for upstream parity; the fork accepts native Windows
// paths, so this message is no longer returned.
export const UNSUPPORTED_NATIVE_WINDOWS_PROJECT_PATH_MESSAGE =
  "Native Windows paths are not supported. Use a POSIX path like /home/me/repo or /mnt/c/Users/me/repo.";

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

  // bb-fork(windows): drive-letter and UNC paths count as absolute.
  return trimmedPath.startsWith("/") || isNativeWindowsProjectPath(trimmedPath);
}

export function normalizeProjectPathInput(path: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "";
  }

  if (trimmedPath === "/") {
    return trimmedPath;
  }

  return trimmedPath.replace(/\/+$/u, "");
}

export function getProjectPathValidationMessage(path: string): string | null {
  const normalizedPath = normalizeProjectPathInput(path);
  if (!normalizedPath) {
    return INVALID_PROJECT_PATH_MESSAGE;
  }
  if (isNativeWindowsProjectPath(normalizedPath)) {
    // bb-fork(windows): native Windows paths are valid; bare drive roots are not.
    return isWindowsFilesystemRoot(normalizedPath)
      ? PROJECT_PATH_ROOT_MESSAGE
      : null;
  }
  if (!isAbsoluteProjectPath(normalizedPath)) {
    return INVALID_PROJECT_PATH_MESSAGE;
  }
  if (normalizedPath === "/") {
    return PROJECT_PATH_ROOT_MESSAGE;
  }
  return null;
}

export function deriveProjectNameFromPath(path: string): string {
  const normalizedPath = normalizeProjectPathInput(path);
  // bb-fork(windows): derive names from drive/UNC paths too.
  if (isNativeWindowsProjectPath(normalizedPath)) {
    return deriveWindowsProjectName(normalizedPath);
  }
  if (
    !normalizedPath ||
    normalizedPath === "/" ||
    !isAbsoluteProjectPath(normalizedPath)
  ) {
    return "";
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}
