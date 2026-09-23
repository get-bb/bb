import { z } from "zod";

export const ACCOUNT_REALTIME_CHANNEL = "account";

export const accountSchema = z
  .object({
    userId: z.string(),
    githubLogin: z.string().nullable(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    handle: z.string().nullable(),
    serverId: z.string(),
    serverLabel: z.string(),
    serverUrl: z
      .string()
      .describe("Gate origin, e.g. https://<label>.getbb.app"),
    baseUrl: z.string().describe("Apex origin, e.g. https://getbb.app"),
  })
  .strict();

export type Account = z.infer<typeof accountSchema>;

export const accountStatusSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("signed-out"),
      revision: z.number().int().nonnegative(),
      account: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal("signed-in"),
      revision: z.number().int().nonnegative(),
      account: accountSchema,
    })
    .strict(),
]);

export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const loginStateSchema = z.enum([
  "pending",
  "signed-in",
  "denied",
  "expired",
  "cancelled",
  "failed",
]);

export type LoginState = z.infer<typeof loginStateSchema>;

export const loginViewSchema = z
  .object({
    id: z.string(),
    state: loginStateSchema,
    userCode: z.string(),
    verificationUrl: z.string(),
    expiresAt: z.number(),
    message: z.string().nullable(),
  })
  .strict();

export type LoginView = z.infer<typeof loginViewSchema>;

export const loginPollOutputSchema = z
  .object({
    login: loginViewSchema.nullable(),
    status: accountStatusSchema,
  })
  .strict();

export const accountRealtimePayloadSchema = loginPollOutputSchema;
