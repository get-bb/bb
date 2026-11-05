import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CONNECT_PLUGIN_ID, httpStatusOf, sleep } from "./shares.js";

const remoteAccessSchema = z.object({
  revision: z.number().int(),
  enabled: z.boolean(),
});

export type RemoteAccessState = z.infer<typeof remoteAccessSchema>;

export interface RemoteAccessClient {
  read(signal?: AbortSignal): Promise<RemoteAccessState>;
  waitForChange(
    afterRevision: number,
    signal?: AbortSignal,
  ): Promise<RemoteAccessState>;
}

export function createRemoteAccessClient(
  getSdk: () => BbPluginApi["sdk"],
): RemoteAccessClient {
  const call = (
    method: string,
    input: { afterRevision: number } | null,
    signal?: AbortSignal,
  ) =>
    getSdk().plugins.callRpc({
      pluginId: CONNECT_PLUGIN_ID,
      method,
      input,
      outputSchema: remoteAccessSchema,
      ...(signal === undefined ? {} : { signal }),
    });
  return {
    read: (signal) =>
      call("connect.internal_DO_NOT_USE.remoteAccess", null, signal),
    waitForChange: (afterRevision, signal) =>
      call(
        "connect.internal_DO_NOT_USE.waitForRemoteAccessChange",
        { afterRevision },
        signal,
      ),
  };
}

export interface WatchRemoteAccessOptions {
  remoteAccess: RemoteAccessClient;
  log: PluginLogger;
  onEnabled(enabled: boolean): void;
  retryMinMs?: number;
  retryMaxMs?: number;
}

export async function watchRemoteAccess(
  options: WatchRemoteAccessOptions,
  signal: AbortSignal,
): Promise<void> {
  let revision: number | null = null;
  let failures = 0;
  while (!signal.aborted) {
    try {
      const result: RemoteAccessState =
        revision === null
          ? await options.remoteAccess.read(signal)
          : await options.remoteAccess.waitForChange(revision, signal);
      if (signal.aborted) return;
      revision = result.revision;
      failures = 0;
      options.onEnabled(result.enabled);
    } catch (error) {
      if (signal.aborted) return;
      options.onEnabled(false);
      const status = httpStatusOf(error);
      if (status !== 404 && status !== 503) {
        options.log.warn(
          `could not read bb connect's remote access setting: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      revision = null;
      failures += 1;
      const base = options.retryMinMs ?? 1_000;
      await sleep(
        Math.min(base * 2 ** (failures - 1), options.retryMaxMs ?? 30_000),
        signal,
      );
    }
  }
}
