import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const REMOVE_PATH_RETRY_LIMIT = 10;
const REMOVE_PATH_RETRY_DELAY_MS = 50;
const RETRYABLE_REMOVE_ERROR_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function isRetryableRemoveError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    typeof error.code === "string" &&
    RETRYABLE_REMOVE_ERROR_CODES.has(error.code)
  );
}

export async function removePathWithRetry(pathToRemove: string): Promise<void> {
  for (let attempt = 0; attempt <= REMOVE_PATH_RETRY_LIMIT; attempt += 1) {
    try {
      await fs.rm(pathToRemove, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 0 && process.platform === "win32") {
        console.error("REMOVE_FAILURE", pathToRemove, error);
        const handles = spawnSync(
          path.join(process.env.RUNNER_TEMP!, "handles", "handle64.exe"),
          ["-accepteula", "-nobanner", pathToRemove],
          { encoding: "utf8", timeout: 10000 },
        );
        console.error(
          "OPEN_HANDLES",
          handles.stdout,
          handles.stderr,
          handles.error,
        );
      }
      if (
        !isRetryableRemoveError(error) ||
        attempt === REMOVE_PATH_RETRY_LIMIT
      ) {
        throw error;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, REMOVE_PATH_RETRY_DELAY_MS * (attempt + 1)),
    );
  }
}
