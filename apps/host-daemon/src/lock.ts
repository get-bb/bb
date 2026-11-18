import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { isFsErrorWithCode } from "./fs-errors.js";

export const DAEMON_LOCK_FILE_NAME = "daemon.lock";

const DAEMON_LOCK_STALE_MS = 10_000;
const DAEMON_LOCK_RETRY_INTERVAL_MS = 1_000;
const DAEMON_LOCK_ACQUIRE_RETRIES = 13;
const DAEMON_LOCK_REACQUIRE_MAX_CYCLES = 20;

interface ObservedHeartbeat {
  heartbeatMs: number;
  sinceMs: number;
}

interface DaemonLockLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

interface AcquireDaemonLockOptions {
  staleMs?: number;
  retries?: number;
  retryIntervalMs?: number;
  logger?: DaemonLockLogger;
  onLockLost?: (error: unknown) => void;
}

const consoleLockLogger: DaemonLockLogger = {
  warn: (fields, message) => console.warn(message, fields),
  error: (fields, message) => console.error(message, fields),
};

export async function acquireDaemonLock(
  dataDir: string,
  options: AcquireDaemonLockOptions = {},
): Promise<() => Promise<void>> {
  await fs.mkdir(dataDir, { recursive: true });

  const lockPath = path.join(dataDir, DAEMON_LOCK_FILE_NAME);
  await fs.writeFile(lockPath, "", { encoding: "utf8", flag: "a" });

  const lockDirPath = `${lockPath}.lock`;
  const staleMs = options.staleMs ?? DAEMON_LOCK_STALE_MS;
  const retryIntervalMs =
    options.retryIntervalMs ?? DAEMON_LOCK_RETRY_INTERVAL_MS;
  const retries = options.retries ?? DAEMON_LOCK_ACQUIRE_RETRIES;
  const logger = options.logger ?? consoleLockLogger;
  const onLockLost = options.onLockLost ?? (() => process.exit(1));

  let released = false;
  let reacquiring = false;
  let holdsLock = false;
  let release: (() => Promise<void>) | null = null;

  function handleCompromised(error: Error): void {
    if (released || reacquiring) {
      return;
    }
    reacquiring = true;
    holdsLock = false;
    logger.warn(
      { err: error },
      "Daemon lock compromised; re-acquiring without restarting the daemon",
    );
    void (async () => {
      try {
        for (let cycle = 1; !released; cycle += 1) {
          try {
            const reacquiredRelease = await lockDaemonLockFile();
            if (released) {
              await reacquiredRelease().catch(() => undefined);
              return;
            }
            release = reacquiredRelease;
            holdsLock = true;
            logger.warn({}, "Daemon lock re-acquired after compromise");
            return;
          } catch (acquireError) {
            if (released) {
              return;
            }
            if (isFsErrorWithCode(acquireError, "ELOCKED")) {
              logger.error(
                { err: acquireError },
                "Daemon lock is held by another live daemon; yielding the data dir",
              );
              onLockLost(acquireError);
              return;
            }
            if (cycle >= DAEMON_LOCK_REACQUIRE_MAX_CYCLES) {
              logger.error(
                { err: acquireError, cycle },
                "Daemon lock could not be re-acquired after repeated attempts; yielding the data dir",
              );
              onLockLost(acquireError);
              return;
            }
            logger.error(
              { err: acquireError, cycle },
              "Re-acquiring the compromised daemon lock failed; retrying",
            );
            await sleep(retryIntervalMs, undefined, { ref: false });
          }
        }
      } finally {
        reacquiring = false;
      }
    })();
  }

  async function lockDaemonLockFile(): Promise<() => Promise<void>> {
    let observedHeartbeat: ObservedHeartbeat | null = null;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await lockfile.lock(lockPath, {
          realpath: false,
          stale: staleMs,
          lockfilePath: lockDirPath,
          onCompromised: handleCompromised,
        });
      } catch (error) {
        if (!isFsErrorWithCode(error, "ELOCKED") || attempt >= retries) {
          throw error;
        }
      }
      const heartbeatMs = await readHeartbeatMs(lockDirPath);
      const observedAtMs = performance.now();
      if (heartbeatMs === null) {
        observedHeartbeat = null;
        continue;
      }
      if (
        observedHeartbeat === null ||
        observedHeartbeat.heartbeatMs !== heartbeatMs
      ) {
        observedHeartbeat = { heartbeatMs, sinceMs: observedAtMs };
      } else if (observedAtMs - observedHeartbeat.sinceMs >= staleMs) {
        logger.warn(
          { lockDirPath, heartbeatAt: new Date(heartbeatMs).toISOString() },
          "Daemon lock heartbeat stopped; reclaiming the orphaned lock",
        );
        await removeLockDir(lockDirPath);
        observedHeartbeat = null;
        continue;
      }
      await sleep(retryIntervalMs);
    }
  }

  release = await lockDaemonLockFile();
  holdsLock = true;

  const onExit = () => {
    if (!holdsLock) {
      return;
    }
    try {
      fsSync.rmSync(lockDirPath, { recursive: true, force: true });
    } catch {}
  };
  process.once("exit", onExit);

  return async () => {
    if (released) {
      return;
    }
    released = true;
    process.removeListener("exit", onExit);
    try {
      await release?.();
    } catch (error) {
      if (!isFsErrorWithCode(error, "ERELEASED")) {
        throw error;
      }
    }
    holdsLock = false;
  };
}

async function readHeartbeatMs(lockDirPath: string): Promise<number | null> {
  try {
    return (await fs.stat(lockDirPath)).mtimeMs;
  } catch (error) {
    if (isFsErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function removeLockDir(lockDirPath: string): Promise<void> {
  try {
    await fs.rmdir(lockDirPath);
  } catch (error) {
    if (!isFsErrorWithCode(error, "ENOENT")) {
      throw error;
    }
  }
}
