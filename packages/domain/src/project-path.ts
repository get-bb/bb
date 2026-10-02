import {
  getHostPathBasename,
  getHostPathFlavor,
  isHostPathRoot,
  isWindowsUncHostPath,
  normalizeHostPath,
} from "./host-path.js";

export const INVALID_PROJECT_PATH_MESSAGE =
  "Project path must be an absolute path.";
export const PROJECT_PATH_ROOT_MESSAGE =
  "Project path must point to a project directory, not the filesystem root.";
export const UNSUPPORTED_WINDOWS_NETWORK_PROJECT_PATH_MESSAGE =
  "Windows network paths are not supported. Map the share to a drive letter and use a path like C:\\Users\\me\\repo.";

function isWindowsDriveProjectPath(path: string): boolean {
  return getHostPathFlavor(path) === "windows" && !isWindowsUncHostPath(path);
}

export function isAbsoluteProjectPath(path: string): boolean {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return false;
  }

  return trimmedPath.startsWith("/") || isWindowsDriveProjectPath(trimmedPath);
}

export function normalizeProjectPathInput(path: string): string {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    return "";
  }

  if (isWindowsDriveProjectPath(trimmedPath)) {
    return normalizeHostPath(trimmedPath) ?? trimmedPath;
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
  if (isWindowsUncHostPath(normalizedPath)) {
    return UNSUPPORTED_WINDOWS_NETWORK_PROJECT_PATH_MESSAGE;
  }
  if (!isAbsoluteProjectPath(normalizedPath)) {
    return INVALID_PROJECT_PATH_MESSAGE;
  }
  if (isHostPathRoot(normalizedPath)) {
    return PROJECT_PATH_ROOT_MESSAGE;
  }
  return null;
}

export function deriveProjectNameFromPath(path: string): string {
  const normalizedPath = normalizeProjectPathInput(path);
  if (getProjectPathValidationMessage(normalizedPath) !== null) {
    return "";
  }

  return getHostPathBasename(normalizedPath) ?? "";
}
