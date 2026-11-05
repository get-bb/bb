import type { FakeRpcArgs } from "./fake-account.js";

interface Waiter {
  resolve(): void;
  reject(error: unknown): void;
}

class Feed<Value> {
  revision = 1;
  private readonly waiters = new Set<Waiter>();

  constructor(public value: Value) {}

  set(value: Value): void {
    this.value = value;
    this.revision += 1;
    for (const waiter of [...this.waiters]) waiter.resolve();
  }

  fail(error: unknown): void {
    for (const waiter of [...this.waiters]) waiter.reject(error);
  }

  wait(afterRevision: number, signal: AbortSignal | undefined): Promise<void> {
    if (this.revision > afterRevision) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve: () => {
          this.waiters.delete(waiter);
          signal?.removeEventListener("abort", abort);
          resolve();
        },
        reject: (error) => {
          this.waiters.delete(waiter);
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      };
      const abort = () => waiter.reject(signal?.reason ?? new Error("aborted"));
      this.waiters.add(waiter);
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

function notRunning(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}: connect is not running`), {
    status,
  });
}

export class FakeConnect {
  available = true;
  readonly calls: string[] = [];
  private readonly shares = new Feed<number[]>([]);
  private readonly remoteAccess = new Feed<boolean>(true);

  setPorts(ports: number[]): void {
    this.shares.set([...ports]);
  }

  setRemoteAccess(enabled: boolean): void {
    this.remoteAccess.set(enabled);
  }

  disable(): void {
    this.available = false;
    this.shares.fail(notRunning(404));
    this.remoteAccess.fail(notRunning(404));
  }

  enable(): void {
    this.available = true;
  }

  readonly callRpc = async (args: FakeRpcArgs): Promise<unknown> => {
    this.calls.push(args.method);
    if (args.pluginId !== "connect" || !this.available) {
      throw notRunning(503);
    }
    const afterRevision = () =>
      (args.input as { afterRevision: number }).afterRevision;
    switch (args.method) {
      case "connect.internal_DO_NOT_USE.serverShares":
        return args.outputSchema.parse(this.sharesSnapshot());
      case "connect.internal_DO_NOT_USE.waitForServerSharesChange":
        await this.shares.wait(afterRevision(), args.signal);
        return args.outputSchema.parse(this.sharesSnapshot());
      case "connect.internal_DO_NOT_USE.remoteAccess":
        return args.outputSchema.parse(this.remoteAccessSnapshot());
      case "connect.internal_DO_NOT_USE.waitForRemoteAccessChange":
        await this.remoteAccess.wait(afterRevision(), args.signal);
        return args.outputSchema.parse(this.remoteAccessSnapshot());
    }
    throw new Error(`unknown connect method ${args.method}`);
  };

  private sharesSnapshot() {
    return { revision: this.shares.revision, ports: this.shares.value };
  }

  private remoteAccessSnapshot() {
    return {
      revision: this.remoteAccess.revision,
      enabled: this.remoteAccess.value,
    };
  }
}

export function routeRpc(handlers: {
  account: { callRpc(args: FakeRpcArgs): Promise<unknown> };
  connect: { callRpc(args: FakeRpcArgs): Promise<unknown> };
}) {
  return (args: FakeRpcArgs) =>
    args.pluginId === "connect"
      ? handlers.connect.callRpc(args)
      : handlers.account.callRpc(args);
}
