import type { HostDaemonLogger } from "./logger.js";
import { normalizeCaughtError } from "./error-utils.js";

interface HostDaemonIdentity {
  hostId: string;
  hostName: string;
  instanceId: string;
}

interface SignalSource {
  on(event: NodeJS.Signals, listener: () => void): void;
  off(event: NodeJS.Signals, listener: () => void): void;
}

interface CreateDaemonOptions {
  identity: HostDaemonIdentity;
  logger: HostDaemonLogger;
  releaseLock: () => Promise<void>;
  flushEvents?: () => Promise<void>;
  shutdownRuntimes?: () => Promise<void>;
  onStart?: () => Promise<void>;
  signalSource?: SignalSource;
  forceExit?: (code: number) => void;
  shutdownExitGraceMs?: number;
}

export interface HostDaemon {
  readonly identity: HostDaemonIdentity;
  start(): Promise<void>;
  shutdown(reason?: string): Promise<void>;
  waitUntilStopped(): Promise<void>;
}

const TERMINATION_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

const DEFAULT_SHUTDOWN_EXIT_GRACE_MS = 15_000;

export function createDaemon(options: CreateDaemonOptions): HostDaemon {
  let started = false;
  let stopPromise: Promise<void> | null = null;
  let stopFailure: Error | null = null;

  let resolveStopped: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const signalSource = options.signalSource ?? process;
  const listeners = new Map<NodeJS.Signals, () => void>();

  function unregisterSignalHandlers(): void {
    for (const [signal, listener] of listeners) {
      signalSource.off(signal, listener);
    }
    listeners.clear();
  }

  function armShutdownExitWatchdog(reason: string): void {
    const forceExit = options.forceExit;
    if (!forceExit) {
      return;
    }

    const graceMs =
      options.shutdownExitGraceMs ?? DEFAULT_SHUTDOWN_EXIT_GRACE_MS;
    const timer = setTimeout(() => {
      options.logger.error(
        { reason, graceMs, activeResources: process.getActiveResourcesInfo() },
        "Host daemon shutdown did not end the process; forcing exit so the service manager can restart it.",
      );
      forceExit(0);
    }, graceMs);
    timer.unref?.();
  }

  async function stop(reason: string): Promise<void> {
    if (stopPromise) {
      return stopPromise;
    }

    armShutdownExitWatchdog(reason);

    stopPromise = (async () => {
      unregisterSignalHandlers();
      options.logger.info(
        { mode: "shutdown", reason },
        "Shutting down host daemon",
      );

      let failure: Error | null = null;
      const steps = [
        {
          name: "flushEvents",
          run: options.flushEvents,
        },
        {
          name: "shutdownRuntimes",
          run: options.shutdownRuntimes,
        },
        {
          name: "releaseLock",
          run: options.releaseLock,
        },
      ] as const;

      for (const step of steps) {
        if (!step.run) {
          continue;
        }

        try {
          await step.run();
        } catch (error) {
          const stepError = normalizeCaughtError(error);
          failure ??= stepError;
          options.logger.error(
            { err: stepError, step: step.name },
            "Shutdown step failed",
          );
        }
      }

      if (failure) {
        stopFailure = failure;
        resolveStopped?.();
        throw failure;
      }

      resolveStopped?.();
    })();

    return stopPromise;
  }

  async function shutdown(reason = "shutdown"): Promise<void> {
    return stop(reason);
  }

  return {
    identity: options.identity,
    async start(): Promise<void> {
      if (started) {
        return;
      }

      for (const signal of TERMINATION_SIGNALS) {
        const listener = () => {
          void stop(signal).catch((error) => {
            options.logger.error(
              { err: error, signal },
              "Signal-triggered host daemon shutdown failed",
            );
          });
        };
        listeners.set(signal, listener);
        signalSource.on(signal, listener);
      }

      try {
        await options.onStart?.();
        started = true;
        options.logger.info(
          { identity: options.identity },
          "Host daemon started",
        );
      } catch (error) {
        await stop("startup-failed").catch(() => undefined);
        throw error;
      }
    },
    shutdown,
    async waitUntilStopped(): Promise<void> {
      await stopped;
      if (stopFailure) {
        throw stopFailure;
      }
    },
  };
}
