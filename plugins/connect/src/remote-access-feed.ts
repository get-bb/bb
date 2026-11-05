import { z } from "zod";
import {
  defineRpcContract,
  type ExperimentalPluginRpcHandlersWithContext,
} from "@get-bb/plugin-sdk";
import { RevisionFeed, assertConnectNext } from "./server-shares.js";

export const REMOTE_ACCESS_METHOD = "connect.internal_DO_NOT_USE.remoteAccess";
export const WAIT_FOR_REMOTE_ACCESS_CHANGE_METHOD =
  "connect.internal_DO_NOT_USE.waitForRemoteAccessChange";
export const REMOTE_ACCESS_LONG_POLL_MS = 25_000;
const REMOTE_ACCESS = "whether remote access is on";

const remoteAccessSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    enabled: z.boolean(),
  })
  .strict();

export type RemoteAccessState = z.infer<typeof remoteAccessSchema>;

export const connectRemoteAccessRpcContract = defineRpcContract({
  [REMOTE_ACCESS_METHOD]: {
    input: z.object({}).strict().nullable(),
    output: remoteAccessSchema,
  },
  [WAIT_FOR_REMOTE_ACCESS_CHANGE_METHOD]: {
    input: z.object({ afterRevision: z.number().int() }).strict(),
    output: remoteAccessSchema,
  },
});

export class RemoteAccessFeed {
  private readonly changes = new RevisionFeed();

  constructor(private value: boolean) {}

  get enabled(): boolean {
    return this.value;
  }

  set(enabled: boolean): void {
    if (enabled === this.value) return;
    this.value = enabled;
    this.changes.bump();
  }

  read(): RemoteAccessState {
    return { revision: this.changes.revision, enabled: this.value };
  }

  wait(
    afterRevision: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.changes.wait(afterRevision, timeoutMs, signal);
  }

  dispose(): void {
    this.changes.dispose();
  }
}

export function createRemoteAccessHandlers(args: {
  feed: RemoteAccessFeed;
  longPollMs?: number;
}): ExperimentalPluginRpcHandlersWithContext<
  typeof connectRemoteAccessRpcContract
> {
  return {
    [REMOTE_ACCESS_METHOD]: (_input, context) => {
      assertConnectNext(context.experimental_caller, REMOTE_ACCESS);
      return args.feed.read();
    },
    [WAIT_FOR_REMOTE_ACCESS_CHANGE_METHOD]: async (input, context) => {
      assertConnectNext(context.experimental_caller, REMOTE_ACCESS);
      const signal = context.experimental_signal;
      await args.feed.wait(
        input.afterRevision,
        args.longPollMs ?? REMOTE_ACCESS_LONG_POLL_MS,
        signal,
      );
      if (signal.aborted) throw new Error("connect stopped");
      return args.feed.read();
    },
  };
}
