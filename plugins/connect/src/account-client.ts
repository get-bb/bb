import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const ACCOUNT_PLUGIN_ID = "bb-account";

const accountSchema = z.object({
  userId: z.string(),
  githubLogin: z.string().nullable(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  handle: z.string().nullable(),
  serverId: z.string(),
  serverLabel: z.string(),
  serverUrl: z.string(),
  baseUrl: z.string(),
});

export type Account = z.infer<typeof accountSchema>;

export const accountStatusSchema = z.union([
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

export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const loginViewSchema = z.object({
  id: z.string(),
  state: z.enum([
    "pending",
    "signed-in",
    "denied",
    "expired",
    "cancelled",
    "failed",
  ]),
  userCode: z.string(),
  verificationUrl: z.string(),
  expiresAt: z.number(),
  message: z.string().nullable(),
});

export type LoginView = z.infer<typeof loginViewSchema>;

export const loginPollOutputSchema = z.object({
  login: loginViewSchema.nullable(),
  status: accountStatusSchema,
});

const fetchResultSchema = z.object({
  status: z.number().int(),
  body: z.json().nullable(),
});

export type AccountFetchResult = z.infer<typeof fetchResultSchema>;

export interface AccountFetchRequest {
  target: "api" | "gate";
  method: "GET" | "POST";
  path: string;
  body: AccountFetchResult["body"];
}

const adoptResultSchema = z.object({ adopted: z.boolean() });

export class AccountUnavailableError extends Error {
  constructor(detail: string) {
    super(`bb account isn't running (${detail})`);
    this.name = "AccountUnavailableError";
  }
}

function httpStatusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  return typeof error.status === "number" ? error.status : null;
}

export function accountErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^HTTP \d+: /u, "");
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
  }): Promise<{ adopted: boolean }>;
  redeemCode(input: {
    code: string;
    baseUrl: string | null;
  }): Promise<AccountStatus>;
}

export function createAccountClient(
  getSdk: () => BbPluginApi["sdk"],
): AccountClient {
  async function call<T>(
    method: string,
    input: AccountFetchResult["body"],
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
    fetch: (request) =>
      call(
        "bb-account.v1.fetch",
        {
          target: request.target,
          method: request.method,
          path: request.path,
          body: request.body,
        },
        fetchResultSchema,
      ),
    adoptConnectCredential: (input) =>
      call("bb-account.v1.adoptConnectCredential", input, adoptResultSchema),
    redeemCode: (input) => call("redeemCode", input, accountStatusSchema),
  };
}
