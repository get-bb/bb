import { writeFileSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 25;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function mutateManagedJsonFile<T extends object>(args: {
  path: string;
  read: () => Promise<T>;
  mutate: (current: T) => T;
}): Promise<void> {
  const directory = dirname(args.path);
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, `.${basename(args.path)}.lock`);
  try {
    writeFileSync(lockPath, "", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!hasCode(error, "EEXIST")) {
      throw error;
    }
  }

  const { default: Database } = await import("better-sqlite3");
  const lock = new Database(lockPath, { timeout: 0 });
  try {
    const deadline = performance.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        lock.exec("BEGIN IMMEDIATE");
        break;
      } catch (error) {
        if (!hasCode(error, "SQLITE_BUSY")) {
          throw error;
        }
        if (performance.now() >= deadline) {
          throw new Error(
            `Timed out waiting to update ${args.path}; another bb-app command is updating it. Retry the command.`,
          );
        }
        await sleep(LOCK_RETRY_MS);
      }
    }

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
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  } finally {
    lock.close();
  }
}
