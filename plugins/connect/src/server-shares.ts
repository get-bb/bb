import { z } from "zod";
import {
  defineRpcContract,
  type ExperimentalPluginRpcCaller,
  type ExperimentalPluginRpcHandlersWithContext,
} from "@get-bb/plugin-sdk";

export const CONNECT_NEXT_PLUGIN_ID = "bb--connect-next";
export const SERVER_SHARES_METHOD = "connect.internal_DO_NOT_USE.serverShares";
export const WAIT_FOR_SERVER_SHARES_CHANGE_METHOD =
  "connect.internal_DO_NOT_USE.waitForServerSharesChange";
export const SERVER_SHARES_LONG_POLL_MS = 25_000;
const SHARED_PORTS = "the server's shared ports";

const serverSharesSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    ports: z.array(z.number().int().min(1).max(65535)),
  })
  .strict();

export type ServerShares = z.infer<typeof serverSharesSchema>;

export const connectServerSharesRpcContract = defineRpcContract({
  [SERVER_SHARES_METHOD]: {
    input: z.object({}).strict().nullable(),
    output: serverSharesSchema,
  },
  [WAIT_FOR_SERVER_SHARES_CHANGE_METHOD]: {
    input: z.object({ afterRevision: z.number().int() }).strict(),
    output: serverSharesSchema,
  },
});

export class RevisionFeed {
  private current = 0;
  private readonly waiters = new Set<() => void>();

  get revision(): number {
    return this.current;
  }

  bump(): void {
    this.current += 1;
    for (const wake of [...this.waiters]) wake();
  }

  wait(
    afterRevision: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.current > afterRevision || signal?.aborted === true) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
      this.waiters.add(finish);
      signal?.addEventListener("abort", finish, { once: true });
    });
  }

  dispose(): void {
    for (const wake of [...this.waiters]) wake();
  }
}

export function assertConnectNext(
  caller: ExperimentalPluginRpcCaller,
  what: string,
): void {
  if (caller.kind !== "plugin" || caller.pluginId !== CONNECT_NEXT_PLUGIN_ID) {
    throw new Error(`only bb connect next can read ${what}`);
  }
}

export function createServerSharesHandlers(args: {
  changes: RevisionFeed;
  serverPorts: () => Promise<number[]>;
  longPollMs?: number;
}): ExperimentalPluginRpcHandlersWithContext<
  typeof connectServerSharesRpcContract
> {
  const read = async (): Promise<ServerShares> => {
    const revision = args.changes.revision;
    return { revision, ports: await args.serverPorts() };
  };
  return {
    [SERVER_SHARES_METHOD]: (_input, context) => {
      assertConnectNext(context.experimental_caller, SHARED_PORTS);
      return read();
    },
    [WAIT_FOR_SERVER_SHARES_CHANGE_METHOD]: async (input, context) => {
      assertConnectNext(context.experimental_caller, SHARED_PORTS);
      await args.changes.wait(
        input.afterRevision,
        args.longPollMs ?? SERVER_SHARES_LONG_POLL_MS,
        context.experimental_signal,
      );
      return read();
    },
  };
}
