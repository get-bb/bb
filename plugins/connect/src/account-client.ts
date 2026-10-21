import {
  defineRpcContract,
  type BbPluginApi,
  type JsonValue,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const ACCOUNT_PLUGIN_ID = "bb-account";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

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

const baseUrlOverrideSchema = z.string().url().nullable();

export const accountLoginRpcContract = defineRpcContract({
  "login.start": {
    input: z.object({ baseUrl: baseUrlOverrideSchema }).strict(),
    output: loginViewSchema,
  },
  "login.poll": {
    input: z.object({ loginId: z.string().min(1).nullable() }).strict(),
    output: loginPollOutputSchema,
  },
  "login.cancel": {
    input: z.object({ loginId: z.string().min(1) }).strict(),
    output: z.object({ login: loginViewSchema.nullable() }),
  },
  redeemCode: {
    input: z
      .object({ code: z.string().min(1), baseUrl: baseUrlOverrideSchema })
      .strict(),
    output: accountStatusSchema,
  },
});

const fetchResultSchema = z.object({
  status: z.number().int(),
  body: jsonValueSchema.nullable(),
});

export type AccountFetchResult = z.infer<typeof fetchResultSchema>;

export interface AccountFetchRequest {
  target: "api" | "gate";
  method: "GET" | "POST";
  path: string;
  body: AccountFetchResult["body"];
}

const adoptResultSchema = z.object({
  result: z.enum(["adopted", "rejected", "changed"]),
});

export type AdoptResult = z.infer<typeof adoptResultSchema>["result"];

const sharedCredentialSchema = z.object({
  baseUrl: z.string(),
  serverUrl: z.string(),
  serverId: z.string(),
  credential: z.string().min(1),
});

export type SharedCredential = z.infer<typeof sharedCredentialSchema>;

const connectCredentialResultSchema = z.object({
  credential: sharedCredentialSchema.nullable(),
});

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
  watchStatus(options: {
    signal: AbortSignal;
    prepare(status: AccountStatus): void | Promise<void>;
    onChange(status: AccountStatus): void;
    onError(error: Error): void;
  }): ReturnType<BbPluginApi["sdk"]["plugins"]["experimental_watchRpc"]>;
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
      if (
        status === 503 &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "server_moving"
      ) {
        throw error;
      }
      if (status === 503 || status === 404) {
        throw new AccountUnavailableError(`HTTP ${status}`);
      }
      throw error;
    }
  }

  return {
    status: (signal) =>
      call("bb-account.v1.status", {}, accountStatusSchema, signal),
    watchStatus: (options) =>
      getSdk().plugins.experimental_watchRpc({
        ...options,
        pluginId: ACCOUNT_PLUGIN_ID,
        method: "bb-account.v1.status",
        input: {},
        outputSchema: accountStatusSchema,
        onError: (error) => {
          if (
            httpStatusOf(error) === 503 &&
            "code" in error &&
            error.code === "server_moving"
          )
            options.onError(error);
          else
            options.onError(
              httpStatusOf(error) === 404 || httpStatusOf(error) === 503
                ? new AccountUnavailableError(error.message)
                : error,
            );
        },
      }),
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
    connectCredential: async () =>
      (
        await call(
          "bb-account.v1.connectCredential",
          {},
          connectCredentialResultSchema,
        )
      ).credential,
    confirmRefusedCredential: (credential) =>
      call(
        "bb-account.v1.confirmRefusedCredential",
        { credential },
        accountStatusSchema,
      ),
    redeemCode: (input) => call("redeemCode", input, accountStatusSchema),
  };
}
