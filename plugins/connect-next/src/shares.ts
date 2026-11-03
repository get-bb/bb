import type { BbPluginApi, PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const CONNECT_PLUGIN_ID = "connect";
export const SHARE_PROXY_PREFIX = "share-";

const serverSharesSchema = z.object({
  revision: z.number().int(),
  ports: z.array(z.number().int().min(1).max(65535)),
});

export type ServerShares = z.infer<typeof serverSharesSchema>;

export interface SharesClient {
  serverShares(signal?: AbortSignal): Promise<ServerShares>;
  waitForChange(
    afterRevision: number,
    signal?: AbortSignal,
  ): Promise<ServerShares>;
}

export function createSharesClient(
  getSdk: () => BbPluginApi["sdk"],
): SharesClient {
  const call = (
    method: string,
    input: { afterRevision: number } | null,
    signal?: AbortSignal,
  ) =>
    getSdk().plugins.callRpc({
      pluginId: CONNECT_PLUGIN_ID,
      method,
      input,
      outputSchema: serverSharesSchema,
      ...(signal === undefined ? {} : { signal }),
    });
  return {
    serverShares: (signal) =>
      call("connect.internal_DO_NOT_USE.serverShares", null, signal),
    waitForChange: (afterRevision, signal) =>
      call(
        "connect.internal_DO_NOT_USE.waitForServerSharesChange",
        { afterRevision },
        signal,
      ),
  };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
  });
}

function httpStatusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  return typeof error.status === "number" ? error.status : null;
}

export interface WatchSharesOptions {
  shares: SharesClient;
  log: PluginLogger;
  onPorts(ports: number[]): void;
  retryMinMs?: number;
  retryMaxMs?: number;
}

export async function watchServerShares(
  options: WatchSharesOptions,
  signal: AbortSignal,
): Promise<void> {
  let revision: number | null = null;
  let failures = 0;
  while (!signal.aborted) {
    try {
      const result: ServerShares =
        revision === null
          ? await options.shares.serverShares(signal)
          : await options.shares.waitForChange(revision, signal);
      if (signal.aborted) return;
      revision = result.revision;
      failures = 0;
      options.onPorts(result.ports);
    } catch (error) {
      if (signal.aborted) return;
      const status = httpStatusOf(error);
      if (status === 404 || status === 503) {
        options.onPorts([]);
      } else {
        options.log.warn(
          `could not read the server's shared ports from connect: ${error instanceof Error ? error.message : String(error)}`,
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

export function shareProxyName(port: number): string {
  return `${SHARE_PROXY_PREFIX}${port}`;
}

export function shareSubdomain(label: string, port: number): string {
  return `${label}--${port}`;
}
