import { createForkChannel } from "./parcel-subprocess/fork-channel.js";
import {
  createParcelWatcherProxy,
  type ParcelWatcherProxy,
} from "./parcel-subprocess/parcel-watcher-proxy.js";

// Type-only handle on the @parcel/watcher module. Importing the *types* never
// loads the native addon, so the parent process stays parcel-free when the
// daemon installs the subprocess backend — the native backend, and thus the
// inotify EINTR leak/hang, is confined to the child.
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

export type ParcelWatcherBackendLogLevel = "info" | "warn" | "error";
export type ParcelWatcherBackendLogger = (
  level: ParcelWatcherBackendLogLevel,
  message: string,
  fields?: Record<string, unknown>,
) => void;

/**
 * Build the subprocess-isolated backend: parcel runs in a forked child that is
 * SIGKILLed and respawned (with subscriptions replayed) whenever it dies,
 * wedges, or reports a backend error such as an inotify EINTR. The SIGKILL lets
 * the OS reclaim the child's leaked inotify fds and parked threads wholesale.
 * The host daemon installs this at startup via {@link setParcelWatcherBackend}.
 */
export function createSubprocessParcelWatcherBackend(options?: {
  log?: ParcelWatcherBackendLogger;
}): ParcelWatcherProxy {
  return createParcelWatcherProxy({
    spawnChannel: createForkChannel,
    log: options?.log,
  });
}

let installedBackend: ParcelWatcherBackend | undefined;
let inProcessBackend: ParcelWatcherBackend | undefined;

/**
 * Install the process-wide watcher backend. The daemon calls this once at
 * startup with the subprocess backend. Left unset (e.g. in unit tests) the real
 * in-process watcher is used, so parcel can be mocked directly.
 */
export function setParcelWatcherBackend(backend: ParcelWatcherBackend): void {
  installedBackend = backend;
}

export function getParcelWatcherBackend(): ParcelWatcherBackend {
  if (installedBackend !== undefined) {
    return installedBackend;
  }
  if (inProcessBackend === undefined) {
    inProcessBackend = createInProcessBackend();
  }
  return inProcessBackend;
}

/**
 * Dispose the installed backend (the daemon calls this during shutdown). For the
 * subprocess backend this SIGKILLs the watcher child and clears its timers, so
 * the daemon's event loop can drain and no child is orphaned.
 */
export function disposeParcelWatcherBackend(): void {
  const backend = installedBackend;
  installedBackend = undefined;
  if (
    backend !== undefined &&
    "dispose" in backend &&
    typeof backend.dispose === "function"
  ) {
    (backend as { dispose: () => void }).dispose();
  }
}
