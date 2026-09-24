import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  accountStatusSchema,
  loginPollOutputSchema,
  loginViewSchema,
  signOutResultSchema,
} from "./schemas.js";

export {
  ACCOUNT_REALTIME_CHANNEL,
  type Account,
  type AccountStatus,
  type LoginState,
  type LoginView,
  type SignOutResult,
} from "./schemas.js";

export const ACCOUNT_PLUGIN_ID = "bb-account";
export const CONNECT_PLUGIN_ID = "connect";

export const STATUS_METHOD = "bb-account.v1.status";
export const WAIT_FOR_STATUS_CHANGE_METHOD =
  "bb-account.v1.waitForStatusChange";
export const FETCH_METHOD = "bb-account.v1.fetch";
export const ADOPT_CONNECT_CREDENTIAL_METHOD =
  "bb-account.v1.adoptConnectCredential";

export const LONG_POLL_TIMEOUT_MS = 25_000;
export const FETCH_BODY_MAX_BYTES = 1024 * 1024;
export const FETCH_TIMEOUT_MIN_MS = 1_000;
export const FETCH_TIMEOUT_MAX_MS = 15_000;

const emptyInputSchema = z.object({}).strict().nullable();

export const fetchInputSchema = z
  .object({
    target: z
      .enum(["api", "gate"])
      .describe('"api" is the getbb.app apex; "gate" is this server\'s gate'),
    method: z.enum(["GET", "POST"]),
    path: z
      .string()
      .min(1)
      .max(2048)
      .describe(
        'Starts with "/api/ai/" ("/api/connect/" is reserved for the connect plugin); no query, fragment, "..", or "//"',
      ),
    body: z.json().nullable().default(null),
    timeoutMs: z
      .number()
      .int()
      .min(FETCH_TIMEOUT_MIN_MS)
      .max(FETCH_TIMEOUT_MAX_MS)
      .default(FETCH_TIMEOUT_MAX_MS)
      .describe("Give up on getbb.app after this many milliseconds"),
  })
  .strict();

export type AccountFetchInput = z.infer<typeof fetchInputSchema>;

export const fetchOutputSchema = z
  .object({
    status: z.number().int(),
    body: z.json().nullable(),
  })
  .strict();

export type AccountFetchResult = z.infer<typeof fetchOutputSchema>;

export const adoptInputSchema = z
  .object({
    credential: z.string().min(1).max(4096),
    baseUrl: z.string().url(),
  })
  .strict();

export const accountRpcContract = defineRpcContract({
  [STATUS_METHOD]: {
    experimental_description:
      "This bb's getbb.app account. revision increases on every change.",
    input: emptyInputSchema,
    output: accountStatusSchema,
  },
  [WAIT_FOR_STATUS_CHANGE_METHOD]: {
    experimental_description:
      "Long-poll: resolves once revision exceeds afterRevision, or after 25 seconds with the current status.",
    input: z.object({ afterRevision: z.number().int() }).strict(),
    output: accountStatusSchema,
  },
  [FETCH_METHOD]: {
    experimental_description:
      'Authenticated JSON request to getbb.app as this server, for paths under "/api/ai/". The credential is attached but never returned. A 401 signs the account out once getbb.app confirms it no longer accepts the credential.',
    input: fetchInputSchema,
    output: fetchOutputSchema,
  },
});

const baseUrlOverrideSchema = z.string().url().nullable().default(null);

export const accountPrivateRpcContract = defineRpcContract({
  [ADOPT_CONNECT_CREDENTIAL_METHOD]: {
    input: adoptInputSchema,
    output: z.object({ adopted: z.boolean() }).strict(),
  },
  "login.start": {
    input: z.object({ baseUrl: baseUrlOverrideSchema }).strict(),
    output: loginViewSchema,
  },
  "login.poll": {
    input: z
      .object({ loginId: z.string().min(1).nullable().default(null) })
      .strict(),
    output: loginPollOutputSchema,
  },
  "login.cancel": {
    input: z.object({ loginId: z.string().min(1) }).strict(),
    output: z.object({ login: loginViewSchema.nullable() }).strict(),
  },
  redeemCode: {
    input: z
      .object({
        code: z.string().trim().min(1).max(64),
        baseUrl: baseUrlOverrideSchema,
      })
      .strict(),
    output: accountStatusSchema,
  },
  signOut: {
    input: emptyInputSchema,
    output: signOutResultSchema,
  },
});

export type RedeemErrorCode =
  | "invalid_code"
  | "expired_code"
  | "already_used"
  | "network";
