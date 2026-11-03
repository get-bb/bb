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

export class ShareChanges {
  private current = 0;
  private readonly waiters = new Set<() => void>();

  get revision(): number {
    return this.current;
  }

  bump(): void {
    this.current += 1;
    for (const wake of [...this.waiters]) wake();
  }

  wait(afterRevision: number, timeoutMs: number): Promise<void> {
    if (this.current > afterRevision) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      timer.unref?.();
      this.waiters.add(finish);
    });
  }

  dispose(): void {
    for (const wake of [...this.waiters]) wake();
  }
}

function assertConnectNext(caller: ExperimentalPluginRpcCaller): void {
  if (caller.kind !== "plugin" || caller.pluginId !== CONNECT_NEXT_PLUGIN_ID) {
    throw new Error("only bb connect next can read the server's shared ports");
  }
}

export function createServerSharesHandlers(args: {
  changes: ShareChanges;
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
      assertConnectNext(context.experimental_caller);
      return read();
    },
    [WAIT_FOR_SERVER_SHARES_CHANGE_METHOD]: async (input, context) => {
      assertConnectNext(context.experimental_caller);
      await args.changes.wait(
        input.afterRevision,
        args.longPollMs ?? SERVER_SHARES_LONG_POLL_MS,
      );
      return read();
    },
  };
}
