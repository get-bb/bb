import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { isFsErrorWithCode } from "./fs-errors.js";

export const DAEMON_LOCK_FILE_NAME = "daemon.lock";

// proper-lockfile refreshes the held lock's mtime while the holder is alive.
// A lock older than the stale window is therefore an abandoned daemon lock.
const DAEMON_LOCK_STALE_MS = 10_000;
const DAEMON_LOCK_RETRY_INTERVAL_MS = 1_000;
const DAEMON_LOCK_ACQUIRE_RETRIES = 13;
// Each failed re-acquire cycle spans the full acquisition retry budget
// (~14s with defaults), so this cap bounds unlocked operation after a
// compromise to roughly five minutes before the daemon yields for a clean
// service-manager restart.
const DAEMON_LOCK_REACQUIRE_MAX_CYCLES = 20;

interface DaemonLockLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

interface AcquireDaemonLockOptions {
  /** Lock is treated as stale once its mtime is older than this many ms. */
  staleMs?: number;
  /**
   * How many times to retry acquisition while a lock exists. Together with
   * retryIntervalMs this must span staleMs: compromise recovery relies on a
   * still-ours lock dir aging past the stale window within the retry budget.
   */
  retries?: number;
  /** Fixed delay between acquisition retries. */
  retryIntervalMs?: number;
  /** Receives lock lifecycle diagnostics. Defaults to the console. */
  logger?: DaemonLockLogger;
  /**
   * Called when, after a compromise, the lock is confirmed held by another
   * live process. Two daemons must never share a data dir, so the default
   * exits the process.
   */
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

  // proper-lockfile creates a directory at `<path>.lock` to hold the lock.
  // We pass lockfilePath explicitly so the exit handler below doesn't rely
  // on an undocumented default.
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

  // A compromised lock (the periodic mtime refresh failed — e.g. a transient
  // EPERM/ENOENT on the lock dir after sleep or an FS hiccup) must not crash
  // the daemon: proper-lockfile's default handler throws from a timer
  // callback, which took down a daemon mid-turn and interrupted every active
  // thread on the host. Instead, re-acquire in place. The acquisition retry
  // profile spans the stale window, so a lock dir that is still ours ages out
  // and is retaken; a lock that stays ELOCKED through every retry is being
  // actively refreshed by another live daemon — only then yield the data dir.
  // Observing for the stale window is the only way to tell those apart, so a
  // genuine contender coexists with us for at most one retry budget (~13s)
  // before we yield; that window only arises when the service manager
  // double-launches. Persistent non-ELOCKED failures are also bounded: after
  // DAEMON_LOCK_REACQUIRE_MAX_CYCLES the daemon yields rather than running
  // unlocked indefinitely.
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
            // Unref'd so a pending retry never keeps a shutting-down
            // process alive.
            await sleep(retryIntervalMs, undefined, { ref: false });
          }
        }
      } finally {
        reacquiring = false;
      }
    })();
  }

  function lockDaemonLockFile(): Promise<() => Promise<void>> {
    return lockfile.lock(lockPath, {
      realpath: false,
      stale: staleMs,
      retries: {
        retries,
        factor: 1,
        minTimeout: retryIntervalMs,
        maxTimeout: retryIntervalMs,
      },
      lockfilePath: lockDirPath,
      onCompromised: handleCompromised,
    });
  }

  release = await lockDaemonLockFile();
  holdsLock = true;

  // Synchronous fallback: if the process exits before the async release
  // completes, remove the lock directory so the next startup isn't blocked.
  // Only while we believe the lock is ours: after a compromise (and
  // especially after yielding to a live contender) the dir may belong to
  // another daemon, and deleting it would compromise that daemon in turn. A
  // leftover dir merely ages out via the stale window.
  const onExit = () => {
    if (!holdsLock) {
      return;
    }
    try {
      fsSync.rmSync(lockDirPath, { recursive: true, force: true });
    } catch {
      // Best-effort — nothing we can do if this fails during exit.
    }
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
      // A compromised lock is already dropped by proper-lockfile.
      if (!isFsErrorWithCode(error, "ERELEASED")) {
        throw error;
      }
    }
    holdsLock = false;
  };
}
