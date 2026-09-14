const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:(?:[\\/]+)?$/u;

export function isWindowsFilesystemRoot(path: string): boolean {
  return WINDOWS_DRIVE_ROOT_PATTERN.test(path);
}

export function deriveWindowsProjectName(normalizedPath: string): string {
  if (isWindowsFilesystemRoot(normalizedPath)) {
    return "";
  }
  return (
    normalizedPath
      .split(/[\\/]+/u)
      .filter(Boolean)
      .at(-1) ?? ""
  );
}
