import { mkdir, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const LOCK_RETRY_MS = 25;
interface NativeFileLocks {
  tryLock: (fd: number) => boolean;
  unlock: (fd: number) => void;
}

let loadedNativeFileLocks: NativeFileLocks | undefined;

function loadNativeFileLocks(): NativeFileLocks {
  if (loadedNativeFileLocks !== undefined) return loadedNativeFileLocks;
  const value: unknown = createRequire(import.meta.url)("fs-native-extensions");
  if (
    value === null ||
    typeof value !== "object" ||
    !("tryLock" in value) ||
    typeof value.tryLock !== "function" ||
    !("unlock" in value) ||
    typeof value.unlock !== "function"
  ) {
    throw new Error("Invalid fs-native-extensions module");
  }
  const tryLock = value.tryLock;
  const unlock = value.unlock;
  loadedNativeFileLocks = {
    tryLock: (fd) => {
      const result: unknown = Reflect.apply(tryLock, value, [fd]);
      if (typeof result !== "boolean") {
        throw new Error("Invalid fs-native-extensions lock result");
      }
      return result;
    },
    unlock: (fd) => {
      Reflect.apply(unlock, value, [fd]);
    },
  };
  return loadedNativeFileLocks;
}

export class FileLockTimeoutError extends Error {
  constructor(readonly path: string) {
    super(`Timed out waiting for file lock: ${path}`);
  }
}

export async function withFileLock<T>(args: {
  path: string;
  timeoutMs: number;
  work: () => Promise<T>;
}): Promise<T> {
  const nativeFileLocks = loadNativeFileLocks();
  await mkdir(dirname(args.path), { recursive: true });
  const handle = await open(args.path, "a+", 0o600);
  let acquired = false;
  try {
    const deadline = performance.now() + args.timeoutMs;
    for (;;) {
      if (nativeFileLocks.tryLock(handle.fd)) {
        acquired = true;
        break;
      }
      if (performance.now() >= deadline) {
        throw new FileLockTimeoutError(args.path);
      }
      await sleep(LOCK_RETRY_MS);
    }
    return await args.work();
  } finally {
    try {
      if (acquired) nativeFileLocks.unlock(handle.fd);
    } finally {
      await handle.close();
    }
  }
}
