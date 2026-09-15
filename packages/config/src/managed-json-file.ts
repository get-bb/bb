import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { FileLockTimeoutError, withFileLock } from "./file-lock.js";

const LOCK_TIMEOUT_MS = 5_000;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function mutateManagedJsonFile<T extends object>(args: {
  path: string;
  read: () => Promise<T>;
  mutate: (current: T) => T;
}): Promise<T> {
  const directory = dirname(args.path);
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, `.${basename(args.path)}.lock`);
  try {
    return await withFileLock({
      path: lockPath,
      timeoutMs: LOCK_TIMEOUT_MS,
      work: async () => {
        const tempPath = join(directory, `.${basename(args.path)}.tmp`);
        try {
          await unlink(tempPath);
        } catch (error) {
          if (!hasCode(error, "ENOENT")) {
            throw error;
          }
        }
        try {
          const next = args.mutate(await args.read());
          await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          });
          await rename(tempPath, args.path);
          return next;
        } finally {
          await unlink(tempPath).catch(() => undefined);
        }
      },
    });
  } catch (error) {
    if (error instanceof FileLockTimeoutError) {
      throw new Error(
        `Timed out waiting to update ${args.path}; another bb command is updating it. Retry the command.`,
      );
    }
    throw error;
  }
}
