import { join } from "node:path";
import { FileLockTimeoutError, acquireFileLock } from "@bb/config/file-lock";

export const SERVER_DATA_DIR_LOCK_FILE_NAME = "server.lock";
const SERVER_DATA_DIR_LOCK_TIMEOUT_MS = 15_000;

export class ServerDataDirInUseError extends Error {
  constructor(readonly dataDir: string) {
    super(
      `Another bb server is using the data directory ${dataDir}. Stop that server before starting another one on this directory.`,
    );
  }
}

const heldLocks = new Map<string, () => Promise<void>>();

export async function lockServerDataDir(args: {
  dataDir: string;
  timeoutMs?: number;
}): Promise<() => Promise<void>> {
  const path = join(args.dataDir, SERVER_DATA_DIR_LOCK_FILE_NAME);
  let release: () => Promise<void>;
  try {
    release = await acquireFileLock({
      path,
      timeoutMs: args.timeoutMs ?? SERVER_DATA_DIR_LOCK_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof FileLockTimeoutError) {
      throw new ServerDataDirInUseError(args.dataDir);
    }
    throw error;
  }
  heldLocks.set(path, release);
  return async () => {
    heldLocks.delete(path);
    await release();
  };
}
