import { createForkChannel } from "./parcel-subprocess/fork-channel.js";
import {
  createParcelWatcherProxy,
  type ParcelWatcherProxy,
} from "./parcel-subprocess/parcel-watcher-proxy.js";

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

export interface ParcelWatcherBackend {
  subscribe(
    dir: string,
    callback: (
      error: ParcelWatcherError,
      events: ParcelWatcherEventBatch,
    ) => unknown,
    opts?: ParcelWatcherSubscribeOptions,
    signal?: AbortSignal,
  ): Promise<ParcelAsyncSubscription>;
}

function createInProcessBackend(): ParcelWatcherBackend {
  return {
    async subscribe(dir, callback, opts, signal) {
      if (signal?.aborted) {
        throw new Error("Parcel watcher subscription was cancelled");
      }
      const { default: parcelWatcher } = await import("@parcel/watcher");
      if (signal?.aborted) {
        throw new Error("Parcel watcher subscription was cancelled");
      }
      const pending = parcelWatcher.subscribe(dir, callback, opts);
      if (!signal) {
        return pending;
      }
      return new Promise<ParcelAsyncSubscription>((resolve, reject) => {
        let cancelled = false;
        const handleAbort = () => {
          if (cancelled) {
            return;
          }
          cancelled = true;
          reject(new Error("Parcel watcher subscription was cancelled"));
        };
        signal.addEventListener("abort", handleAbort, { once: true });
        if (signal.aborted) {
          handleAbort();
        }
        void pending.then(
          (subscription) => {
            signal.removeEventListener("abort", handleAbort);
            if (cancelled) {
              void subscription.unsubscribe().catch(() => {});
              return;
            }
            resolve(subscription);
          },
          (error: unknown) => {
            signal.removeEventListener("abort", handleAbort);
            if (!cancelled) {
              reject(error);
            }
          },
        );
      });
    },
  };
}

type ParcelWatcherBackendLogLevel = "info" | "warn" | "error";
export type ParcelWatcherBackendLogger = (
  level: ParcelWatcherBackendLogLevel,
  message: string,
  fields?: Record<string, unknown>,
) => void;

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
