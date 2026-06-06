import { stat } from "node:fs/promises";

/**
 * Type guard for Node fs errors. Takes `unknown` so callers don't need their
 * own `instanceof Error` pre-check, and narrows to ErrnoException on success.
 */
export function isFsErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

/** True when the path exists and is a directory; false when it does not exist. */
export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}
