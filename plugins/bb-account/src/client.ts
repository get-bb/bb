import type { BbPluginApi, JsonValue, PluginLogger } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import {
  ADOPT_CONNECT_CREDENTIAL_METHOD,
  adoptOutputSchema,
  CONFIRM_REFUSED_CREDENTIAL_METHOD,
  CONNECT_CREDENTIAL_METHOD,
  connectCredentialOutputSchema,
  FETCH_METHOD,
  fetchOutputSchema,
  STATUS_METHOD,
  WAIT_FOR_STATUS_CHANGE_METHOD,
  type AccountFetchResult,
  type AdoptResult,
} from "./contract.js";
import {
  ACCOUNT_PLUGIN_ID,
  accountStatusSchema,
  type Account,
  type AccountStatus,
} from "./schemas.js";

const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export type SharedCredential = NonNullable<
  z.infer<typeof connectCredentialOutputSchema>["credential"]
>;

export interface AccountFetchRequest {
  target: "api" | "gate";
  method: "GET" | "POST";
  path: string;
  body: JsonValue | null;
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
  fetch(request: AccountFetchRequest): Promise<AccountFetchResult>;
  adoptConnectCredential(input: {
    credential: string;
    baseUrl: string;
    replaces: string | null;
  }): Promise<{ result: AdoptResult }>;
  connectCredential(): Promise<SharedCredential | null>;
  confirmRefusedCredential(credential: string): Promise<AccountStatus>;
  redeemCode(input: {
    code: string;
    baseUrl: string | null;
  }): Promise<AccountStatus>;
}

function httpStatusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  return typeof error.status === "number" ? error.status : null;
}

function isServerMoving(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "server_moving"
  );
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
      if ((status === 503 && !isServerMoving(error)) || status === 404) {
        throw new AccountUnavailableError(`HTTP ${status}`);
      }
      throw error;
    }
  }

  return {
    status: (signal) => call(STATUS_METHOD, {}, accountStatusSchema, signal),
    waitForStatusChange: (afterRevision, signal) =>
      call(
        WAIT_FOR_STATUS_CHANGE_METHOD,
        { afterRevision },
        accountStatusSchema,
        signal,
      ),
    fetch: (request) =>
      call(
        FETCH_METHOD,
        {
          target: request.target,
          method: request.method,
          path: request.path,
          body: request.body,
        },
        fetchOutputSchema,
      ),
    adoptConnectCredential: (input) =>
      call(ADOPT_CONNECT_CREDENTIAL_METHOD, input, adoptOutputSchema),
    connectCredential: async () =>
      (await call(CONNECT_CREDENTIAL_METHOD, {}, connectCredentialOutputSchema))
        .credential,
    confirmRefusedCredential: (credential) =>
      call(
        CONFIRM_REFUSED_CREDENTIAL_METHOD,
        { credential },
        accountStatusSchema,
      ),
    redeemCode: (input) => call("redeemCode", input, accountStatusSchema),
  };
}

export interface WatchAccountOptions {
  account: AccountClient;
  log: PluginLogger;
  onAccount(account: Account | null): void;
  sync?(status: AccountStatus): Promise<boolean>;
  retryMinMs?: number;
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

export async function watchAccount(
  options: WatchAccountOptions,
  signal: AbortSignal,
): Promise<void> {
  let revision: number | null = null;
  let syncedRevision: number | null = null;
  let failures = 0;
  while (!signal.aborted) {
    try {
      const status: AccountStatus =
        revision === null
          ? await options.account.status(signal)
          : await options.account.waitForStatusChange(revision, signal);
      if (signal.aborted) return;
      if (options.sync !== undefined && status.revision !== syncedRevision) {
        syncedRevision = status.revision;
        if (await options.sync(status)) {
          revision = null;
          continue;
        }
      }
      revision = status.revision;
      failures = 0;
      options.onAccount(status.account);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof AccountUnavailableError) {
        options.onAccount(null);
      } else {
        options.log.warn(
          `could not read the bb account status: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      revision = null;
      syncedRevision = null;
      failures += 1;
      const base = options.retryMinMs ?? RETRY_MIN_MS;
      await sleep(Math.min(base * 2 ** (failures - 1), RETRY_MAX_MS), signal);
    }
  }
}
