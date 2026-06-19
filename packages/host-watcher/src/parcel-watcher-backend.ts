import { createForkChannel } from "./parcel-subprocess/fork-channel.js";
import { createParcelWatcherProxy } from "./parcel-subprocess/parcel-watcher-proxy.js";

// Type-only handle on the @parcel/watcher module. Importing the *types* never
// loads the native addon, so the parent process stays parcel-free when running
// in subprocess mode (BB_WATCHER_SUBPROCESS=1) — the native backend, and thus
// the inotify EINTR leak/hang, is confined to the child.
type ParcelWatcherModule = typeof import("@parcel/watcher");
type ParcelWatcherSubscribe = ParcelWatcherModule["subscribe"];
type ParcelWatcherCallback = Parameters<ParcelWatcherSubscribe>[1];

export type ParcelWatcherEventBatch = Parameters<ParcelWatcherCallback>[1];
export type ParcelWatcherSubscribeOptions =
  Parameters<ParcelWatcherSubscribe>[2];
export type ParcelAsyncSubscription = Awaited<
  ReturnType<ParcelWatcherSubscribe>
>;
export type ParcelWatcherError = Parameters<ParcelWatcherCallback>[0];

/**
 * The minimal slice of the @parcel/watcher API that {@link RootSubscription}
 * actually uses. Both the real in-process watcher and the subprocess proxy
 * implement this, so swapping between them is invisible to every layer above.
 */
export interface ParcelWatcherBackend {
  subscribe(
    dir: string,
    callback: (
      error: ParcelWatcherError,
      events: ParcelWatcherEventBatch,
    ) => unknown,
    opts?: ParcelWatcherSubscribeOptions,
  ): Promise<ParcelAsyncSubscription>;
}

function createInProcessBackend(): ParcelWatcherBackend {
  return {
    async subscribe(dir, callback, opts) {
      // Lazy import keeps the native addon out of the parent unless we actually
      // watch in-process.
      const { realParcelWatcher } = await import("./real-parcel-watcher.js");
      return realParcelWatcher.subscribe(dir, callback, opts);
    },
  };
}

function createSubprocessBackend(): ParcelWatcherBackend {
  return createParcelWatcherProxy({
    spawnChannel: createForkChannel,
    log: (level, message, fields) => {
      const line = `[host-watcher:subprocess] ${message}`;
      if (level === "error") {
        console.error(line, fields ?? "");
      } else if (level === "warn") {
        console.warn(line, fields ?? "");
      } else {
        console.info(line, fields ?? "");
      }
    },
  });
}

let cachedBackend: ParcelWatcherBackend | undefined;

/**
 * Returns the process-wide parcel watcher backend. Defaults to the real
 * in-process watcher; set BB_WATCHER_SUBPROCESS=1 to isolate parcel in a child
 * process that is transparently respawned (and its subscriptions replayed) when
 * it dies or wedges.
 */
export function getParcelWatcherBackend(): ParcelWatcherBackend {
  if (cachedBackend === undefined) {
    cachedBackend =
      process.env.BB_WATCHER_SUBPROCESS === "1"
        ? createSubprocessBackend()
        : createInProcessBackend();
  }
  return cachedBackend;
}
