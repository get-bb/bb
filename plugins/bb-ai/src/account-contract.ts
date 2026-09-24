import type { JsonValue } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const ACCOUNT_PLUGIN_ID = "bb-account";
export const accountStatusMethod = "bb-account.v1.status";
export const accountFetchMethod = "bb-account.v1.fetch";

export const accountSchema = z.object({
  userId: z.string(),
  githubLogin: z.string().nullable(),
  name: z.string(),
  baseUrl: z.string(),
});
export type Account = z.infer<typeof accountSchema>;

export type AccountStatus =
  | { signedIn: true; account: Account }
  | { signedIn: false };

export const accountStatusSchema = z
  .object({ state: z.string(), account: z.unknown() })
  .transform((status, ctx): AccountStatus => {
    if (status.state !== "signed-in") return { signedIn: false };
    const account = accountSchema.safeParse(status.account);
    if (!account.success) {
      ctx.addIssue({
        code: "custom",
        message: "bb account reported signed-in without an account",
      });
      return z.NEVER;
    }
    return { signedIn: true, account: account.data };
  });

export const accountFetchOutputSchema = z.object({
  status: z.number().int(),
  body: z.unknown(),
});
export type AccountFetchOutput = z.infer<typeof accountFetchOutputSchema>;

export type AccountFetchInput = {
  target: "api" | "gate";
  method: "GET" | "POST";
  path: string;
  body: JsonValue;
  timeoutMs?: number;
};
