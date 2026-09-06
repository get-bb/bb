import path from "node:path";

export function isWindowsHostPath(value: string): boolean {
  return path.win32.isAbsolute(value) && !path.posix.isAbsolute(value);
}

export function isAbsoluteHostPath(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

export function normalizeHostPath(value: string): string {
  return isWindowsHostPath(value)
    ? path.win32.normalize(value)
    : path.posix.normalize(value);
}

export function joinHostPath(
  rootPath: string,
  ...segments: string[]
): string {
  return isWindowsHostPath(rootPath)
    ? path.win32.join(rootPath, ...segments)
    : path.posix.join(rootPath, ...segments);
}

export function dirnameHostPath(value: string): string {
  return isWindowsHostPath(value) || value.includes("\\")
    ? path.win32.dirname(value)
    : path.posix.dirname(value);
}
