import type { BbPluginApi, JsonValue, PluginLogger } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const ACCOUNT_PLUGIN_ID = "bb-account";

const accountSchema = z.object({
  serverId: z.string().min(1),
  serverLabel: z.string().min(1),
  baseUrl: z.string().url(),
});

const accountStatusSchema = z.union([
  z.object({
    state: z.literal("signed-in"),
    revision: z.number().int(),
    account: accountSchema,
  }),
  z.object({
    state: z.string().refine((state) => state !== "signed-in"),
    revision: z.number().int(),
    account: z.null(),
  }),
]);

type AccountStatus = z.infer<typeof accountStatusSchema>;

const connectCredentialResultSchema = z.object({
  credential: z
    .object({
      serverId: z.string(),
      credential: z.string().min(1),
    })
    .nullable(),
});

export interface ServerIdentity {
  serverId: string;
  label: string;
  baseUrl: string;
}

export interface ServerCredential {
  serverId: string;
  credential: string;
}

export class AccountUnavailableError extends Error {
  constructor(detail: string) {
    super(`bb account isn't running (${detail})`);
    this.name = "AccountUnavailableError";
  }
}

export interface AccountClient {
  status(signal?: AbortSignal): Promise<AccountStatus>;
  waitForStatusChange(
    afterRevision: number,
    signal?: AbortSignal,
  ): Promise<AccountStatus>;
  credential(): Promise<ServerCredential | null>;
}

function httpStatusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  return typeof error.status === "number" ? error.status : null;
}

export function createAccountClient(
  getSdk: () => BbPluginApi["sdk"],
): AccountClient {
  async function call<T>(
    method: string,
    input: { [key: string]: JsonValue },
    outputSchema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return await getSdk().plugins.callRpc({
        pluginId: ACCOUNT_PLUGIN_ID,
        method,
        input,
        outputSchema,
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      const status = httpStatusOf(error);
      if (status === 503 || status === 404) {
        throw new AccountUnavailableError(`HTTP ${status}`);
      }
      throw error;
    }
  }
  return {
    status: (signal) =>
      call("bb-account.v1.status", {}, accountStatusSchema, signal),
    waitForStatusChange: (afterRevision, signal) =>
      call(
        "bb-account.v1.waitForStatusChange",
        { afterRevision },
        accountStatusSchema,
        signal,
      ),
    credential: async () =>
      (
        await call(
          "bb-account.v1.connectCredential",
          {},
          connectCredentialResultSchema,
        )
      ).credential,
  };
}

function identityOf(status: AccountStatus): ServerIdentity | null {
  if (status.account === null) return null;
  return {
    serverId: status.account.serverId,
    label: status.account.serverLabel,
    baseUrl: status.account.baseUrl,
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

export interface WatchAccountOptions {
  account: AccountClient;
  log: PluginLogger;
  onIdentity(identity: ServerIdentity | null): void;
  retryMinMs?: number;
  retryMaxMs?: number;
}

export async function watchAccount(
  options: WatchAccountOptions,
  signal: AbortSignal,
): Promise<void> {
  let revision: number | null = null;
  let failures = 0;
  while (!signal.aborted) {
    try {
      const status: AccountStatus =
        revision === null
          ? await options.account.status(signal)
          : await options.account.waitForStatusChange(revision, signal);
      if (signal.aborted) return;
      revision = status.revision;
      failures = 0;
      options.onIdentity(identityOf(status));
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof AccountUnavailableError) {
        options.onIdentity(null);
      } else {
        options.log.warn(
          `could not read the bb account status: ${error instanceof Error ? error.message : String(error)}`,
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
