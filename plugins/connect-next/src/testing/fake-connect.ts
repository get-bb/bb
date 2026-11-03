import type { FakeRpcArgs } from "./fake-account.js";

export class FakeConnectShares {
  available = true;
  private revision = 1;
  private ports: number[] = [];
  private readonly waiters = new Set<() => void>();

  setPorts(ports: number[]): void {
    this.ports = [...ports];
    this.revision += 1;
    for (const waiter of [...this.waiters]) waiter();
  }

  readonly callRpc = async (args: FakeRpcArgs): Promise<unknown> => {
    if (args.pluginId !== "connect" || !this.available) {
      throw Object.assign(new Error("HTTP 503: connect is not running"), {
        status: 503,
      });
    }
    if (args.method === "connect.internal_DO_NOT_USE.serverShares") {
      return args.outputSchema.parse(this.snapshot());
    }
    if (
      args.method === "connect.internal_DO_NOT_USE.waitForServerSharesChange"
    ) {
      const { afterRevision } = args.input as { afterRevision: number };
      return args.outputSchema.parse(
        await this.waitForChange(afterRevision, args.signal),
      );
    }
    throw new Error(`unknown connect method ${args.method}`);
  };

  private snapshot() {
    return { revision: this.revision, ports: this.ports };
  }

  private waitForChange(
    afterRevision: number,
    signal: AbortSignal | undefined,
  ): Promise<{ revision: number; ports: number[] }> {
    if (this.revision > afterRevision) {
      return Promise.resolve(this.snapshot());
    }
    return new Promise((resolve, reject) => {
      const finish = () => {
        this.waiters.delete(finish);
        signal?.removeEventListener("abort", abort);
        resolve(this.snapshot());
      };
      const abort = () => {
        this.waiters.delete(finish);
        reject(signal?.reason ?? new Error("aborted"));
      };
      this.waiters.add(finish);
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
    });
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
