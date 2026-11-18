import { watch, type FSWatcher } from "node:fs";
import path from "node:path";

export const TOOLCHAIN_WATCH_DEBOUNCE_MS = 2_000;
export const TOOLCHAIN_WATCH_MAX_DIRECTORIES = 64;

export interface ToolchainWatchOptions {
  readSearchPath: () => string | undefined;
  onChange: () => void;
  onWatchError: (directory: string, error: unknown) => void;
  watchDirectory?: (
    directory: string,
    listener: () => void,
  ) => Pick<FSWatcher, "close" | "on">;
  setTimeoutFn?: (callback: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface ToolchainWatch {
  resync(): void;
  stop(): void;
}

function searchPathDirectories(searchPath: string | undefined): string[] {
  if (searchPath === undefined) return [];
  const directories = new Set<string>();
  for (const entry of searchPath.split(path.delimiter)) {
    const directory = entry.trim();
    if (directory.length === 0 || !path.isAbsolute(directory)) continue;
    directories.add(path.normalize(directory));
    if (directories.size >= TOOLCHAIN_WATCH_MAX_DIRECTORIES) break;
  }
  return [...directories];
}

function defaultWatchDirectory(
  directory: string,
  listener: () => void,
): FSWatcher {
  return watch(directory, { persistent: false }, listener);
}

export function startToolchainWatch(
  options: ToolchainWatchOptions,
): ToolchainWatch {
  const watchDirectory = options.watchDirectory ?? defaultWatchDirectory;
  const setTimeoutFn =
    options.setTimeoutFn ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimeoutFn =
    options.clearTimeoutFn ??
    ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const watchers = new Map<string, Pick<FSWatcher, "close">>();
  let pending: unknown = null;
  let stopped = false;

  const scheduleChange = () => {
    if (stopped || pending !== null) return;
    pending = setTimeoutFn(() => {
      pending = null;
      if (stopped) return;
      resync();
      options.onChange();
    }, TOOLCHAIN_WATCH_DEBOUNCE_MS);
  };

  const resync = () => {
    if (stopped) return;
    const wanted = new Set(searchPathDirectories(options.readSearchPath()));
    for (const [directory, watcher] of watchers) {
      if (wanted.has(directory)) continue;
      watcher.close();
      watchers.delete(directory);
    }
    for (const directory of wanted) {
      if (watchers.has(directory)) continue;
      try {
        const watcher = watchDirectory(directory, scheduleChange);
        watcher.on("error", (error) => {
          watcher.close();
          watchers.delete(directory);
          options.onWatchError(directory, error);
        });
        watchers.set(directory, watcher);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          (error.code !== "ENOENT" && error.code !== "ENOTDIR")
        ) {
          options.onWatchError(directory, error);
        }
      }
    }
  };

  resync();
  return {
    resync,
    stop() {
      stopped = true;
      if (pending !== null) clearTimeoutFn(pending);
      pending = null;
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
  };
}
