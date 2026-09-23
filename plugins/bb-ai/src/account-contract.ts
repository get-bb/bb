import type { JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const ACCOUNT_PLUGIN_ID = "bb-account";
export const accountStatusMethod = "bb-account.v1.status";
export const accountFetchMethod = "bb-account.v1.fetch";

export const accountSchema = z.object({
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

export const accountStatusSchema = z.object({
  state: z.enum(["signed-out", "signed-in"]),
  revision: z.number(),
  account: accountSchema.nullable(),
});
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const accountFetchOutputSchema = z.object({
  status: z.number().int(),
  body: z.unknown(),
});
export type AccountFetchOutput = z.infer<typeof accountFetchOutputSchema>;

export interface AccountFetchInput {
  [key: string]: JsonValue;
  target: "api" | "gate";
  method: "GET" | "POST";
  path: string;
  body: JsonValue;
}
