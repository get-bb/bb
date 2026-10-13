import { AsyncLocalStorage } from "node:async_hooks";

interface InstallCancellation {
  signal: AbortSignal;
  committed: boolean;
}

const storage = new AsyncLocalStorage<InstallCancellation>();

export class PluginInstallCancelledError extends Error {
  constructor() {
    super("install cancelled");
    this.name = "PluginInstallCancelledError";
  }
}

export function runCancellableInstall<T>(
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  return storage.run({ signal, committed: false }, run);
}

export function installCancellationSignal(): AbortSignal | null {
  const cancellation = storage.getStore();
  return cancellation === undefined || cancellation.committed
    ? null
    : cancellation.signal;
}

export function commitInstall(): void {
  const cancellation = storage.getStore();
  if (cancellation === undefined || cancellation.committed) return;
  if (cancellation.signal.aborted) throw new PluginInstallCancelledError();
  cancellation.committed = true;
}
