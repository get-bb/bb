import { rename } from "node:fs/promises";

// bb-fork(windows): replacing a file another process holds open fails with EPERM
// or EBUSY, so retry the promotion briefly instead of failing the build.
export async function renameWithRetry(
  source: string,
  destination: string,
  attempts = 20,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const retryable =
        code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!retryable || attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
