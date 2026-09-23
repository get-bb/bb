import { posix, win32 } from "node:path";

// bb-fork(windows): the CLI resolves file flags for the daemon host named by the
// invoking thread, which may use a different path convention than the local one.
// Pick the resolver from the path itself, then from the cwd the host reported.
export function isHostAbsolutePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith("\\\\")
  );
}

export function resolveHostPath(cwd: string, file: string): string {
  if (usesWindowsPaths(file)) return win32.resolve(cwd, file);
  if (file.startsWith("/")) return posix.resolve(cwd, file);
  return usesWindowsPaths(cwd)
    ? win32.resolve(cwd, file)
    : posix.resolve(cwd, file);
}

function usesWindowsPaths(value: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\");
}
