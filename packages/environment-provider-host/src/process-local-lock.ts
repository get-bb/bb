import { setTimeout as sleep } from "node:timers/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROCESS_LOCAL_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export type ProcessLocalQueuedLockWork<T> = () => Promise<T>;

export type ProcessLocalQueuedLockSpec = {
  key: string;
  timeoutMs?: number;
};

export class ProcessLocalQueuedLockTimeoutError extends Error {
  readonly key: string;
  readonly timeoutMs: number;

  constructor(args: { key: string; timeoutMs: number }) {
    super(`Timed out waiting for process-local lock ${args.key}`);
    this.name = "ProcessLocalQueuedLockTimeoutError";
    this.key = args.key;
    this.timeoutMs = args.timeoutMs;
  }
}

const heldLocks = new AsyncLocalStorage<Set<string>>();
const lockQueues = new Map<string, Promise<void>>();

function normalizeProcessLocalLockSpecs(
  locks: ProcessLocalQueuedLockSpec[],
): ProcessLocalQueuedLockSpec[] {
  const locksByKey = new Map<string, ProcessLocalQueuedLockSpec>();
  for (const lock of locks) {
    if (!locksByKey.has(lock.key)) {
      locksByKey.set(lock.key, lock);
    }
  }
  return Array.from(locksByKey.values()).sort((left, right) =>
    left.key.localeCompare(right.key),
  );
}

export async function withProcessLocalQueuedLocks<T>(args: {
  locks: ProcessLocalQueuedLockSpec[];
  signal?: AbortSignal;
  work: ProcessLocalQueuedLockWork<T>;
}): Promise<T> {
  const locks = normalizeProcessLocalLockSpecs(args.locks);
  return withProcessLocalQueuedLocksAtIndex({
    locks,
    index: 0,
    signal: args.signal,
    work: args.work,
  });
}

function withProcessLocalQueuedLocksAtIndex<T>(args: {
  locks: ProcessLocalQueuedLockSpec[];
  index: number;
  signal: AbortSignal | undefined;
  work: ProcessLocalQueuedLockWork<T>;
}): Promise<T> {
  const lock = args.locks[args.index];
  if (!lock) {
    return args.work();
  }

  return withProcessLocalQueuedLock({
    lock,
    work: () =>
      withProcessLocalQueuedLocksAtIndex({
        locks: args.locks,
        index: args.index + 1,
        signal: args.signal,
        work: args.work,
      }),
    signal: args.signal,
  });
}

function withProcessLocalQueuedLock<T>(args: {
  lock: ProcessLocalQueuedLockSpec;
  signal: AbortSignal | undefined;
  work: ProcessLocalQueuedLockWork<T>;
}): Promise<T> {
  const held = heldLocks.getStore();
  if (held?.has(args.lock.key)) {
    return args.work();
  }

  return runInProcessQueue(
    args.lock.key,
    () => heldLocks.run(new Set([...(held ?? []), args.lock.key]), args.work),
    args.lock.timeoutMs ?? DEFAULT_PROCESS_LOCAL_LOCK_TIMEOUT_MS,
    args.signal,
  );
}

function lockAbortError(key: string, signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  return new Error(`Aborted waiting for process-local lock ${key}`);
}

function runInProcessQueue<T>(
  key: string,
  work: ProcessLocalQueuedLockWork<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(lockAbortError(key, signal));
  }

  const previous = lockQueues.get(key) ?? Promise.resolve();
  let started = false;
  let aborted = false;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      if (removeAbortListener) {
        removeAbortListener();
        removeAbortListener = undefined;
      }
      if (aborted && signal) {
        throw lockAbortError(key, signal);
      }
      if (timedOut) {
        throw new ProcessLocalQueuedLockTimeoutError({ key, timeoutMs });
      }
      started = true;
      return work();
    });
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  lockQueues.set(key, settled);
  void settled.then(() => {
    if (lockQueues.get(key) === settled) {
      lockQueues.delete(key);
    }
  });
  if (timeoutMs <= 0) {
    return next;
  }

  return new Promise<T>((resolve, reject) => {
    timeout = setTimeout(() => {
      if (started) {
        return;
      }
      timedOut = true;
      reject(new ProcessLocalQueuedLockTimeoutError({ key, timeoutMs }));
    }, timeoutMs);

    if (signal) {
      const onAbort = () => {
        if (started) {
          return;
        }
        aborted = true;
        reject(lockAbortError(key, signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => {
        signal.removeEventListener("abort", onAbort);
      };
    }

    next.then(
      (value) => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        if (removeAbortListener) {
          removeAbortListener();
          removeAbortListener = undefined;
        }
        resolve(value);
      },
      (error: unknown) => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        if (removeAbortListener) {
          removeAbortListener();
          removeAbortListener = undefined;
        }
        reject(error);
      },
    );
  });
}

const GIT_REF_FS_LOCK_DIR_NAME = "bb-ref-mutation.lock";
const GIT_REF_FS_LOCK_STALE_MS = 10 * 60_000;
const GIT_REF_FS_LOCK_POLL_MS = 100;
const GIT_REF_FS_LOCK_DEFAULT_TIMEOUT_MS = 5 * 60_000;

async function acquireGitRefFsLock(
  commonDir: string,
  options: { signal?: AbortSignal; timeoutMs?: number },
): Promise<() => Promise<void>> {
  const lockPath = path.join(commonDir, GIT_REF_FS_LOCK_DIR_NAME);
  const deadline =
    Date.now() + (options.timeoutMs ?? GIT_REF_FS_LOCK_DEFAULT_TIMEOUT_MS);
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      await fs.mkdir(lockPath);
      await fs.writeFile(path.join(lockPath, "owner"), `${process.pid}\n`);
      return async () => {
        await fs.rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      ) {
        throw error;
      }
    }
    const held = await fs.stat(lockPath).catch(() => null);
    if (held !== null && Date.now() - held.mtimeMs > GIT_REF_FS_LOCK_STALE_MS) {
      await fs.rm(lockPath, { recursive: true, force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for the git ref lock held at ${lockPath}`,
      );
    }
    await sleep(GIT_REF_FS_LOCK_POLL_MS, undefined, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }
}

const gitRefMutationLockKeyPrefix = "git-ref-mutation:";

export async function withGitRefMutationLock<T>(
  commonDir: string,
  work: ProcessLocalQueuedLockWork<T>,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const commonDirIdentity = await fs.stat(commonDir, { bigint: true });
  return withProcessLocalQueuedLocks({
    locks: [
      {
        key: `${gitRefMutationLockKeyPrefix}${commonDirIdentity.dev}:${commonDirIdentity.ino}`,
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      },
    ],
    signal: options.signal,
    work: async () => {
      const release = await acquireGitRefFsLock(commonDir, options);
      try {
        return await work();
      } finally {
        await release();
      }
    },
  });
}
