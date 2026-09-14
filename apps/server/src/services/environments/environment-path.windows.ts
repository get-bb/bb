// bb-fork(windows): environment paths on a Windows host are drive-letter
// (C:\...) or UNC (\\server\share) absolute, so the upstream POSIX-only
// startsWith("/") claim validation is replaced by this cross-platform check.
import { z } from "zod";

const WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_ABSOLUTE_PATH_PATTERN = /^[\\/]{2}/u;

function isHostAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.test(path) ||
    WINDOWS_UNC_ABSOLUTE_PATH_PATTERN.test(path)
  );
}

export function parseClaimableEnvironmentPath(value: unknown): string {
  const path = z
    .string()
    .min(1)
    .refine((path) => !path.includes("\0"))
    .parse(value);
  if (!isHostAbsolutePath(path)) {
    throw new Error(
      `Path must be an absolute path on the host, got ${JSON.stringify(path)}`,
    );
  }
  return path;
}
