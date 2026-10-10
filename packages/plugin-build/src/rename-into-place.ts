import { rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const WINDOWS_RENAME_ATTEMPTS = 200;
const WINDOWS_RENAME_RETRY_DELAY_MS = 10;
const WINDOWS_SHARING_ERROR_CODES = new Set(["EACCES", "EBUSY", "EPERM"]);

function errorCode(error: unknown): string | null {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

export async function renameIntoPlace(
  source: string,
  destination: string,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = errorCode(error);
      if (
        process.platform !== "win32" ||
        attempt >= WINDOWS_RENAME_ATTEMPTS ||
        code === null ||
        !WINDOWS_SHARING_ERROR_CODES.has(code)
      ) {
        throw error;
      }
      await delay(WINDOWS_RENAME_RETRY_DELAY_MS);
    }
  }
}
