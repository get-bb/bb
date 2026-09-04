import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  accountAddInputSchema,
  accountIdInputSchema,
  accountSchema,
  accountSummarySchema,
  bypassInputSchema,
  bypassResultSchema,
  hubTokenSummarySchema,
  loginCompleteInputSchema,
  loginStartSchema,
  statusSchema,
  tokenRotateInputSchema,
} from "./contracts.js";
import type { PoolOperations } from "./operations.js";
import type { ClaudeOAuthLogin } from "./oauth-login.js";

export const accountPoolRpcContract = defineRpcContract({
  "account.add": {
    input: accountAddInputSchema,
    output: accountSchema,
  },
  "account.list": {
    input: z.null(),
    output: z.array(accountSummarySchema),
  },
  "account.remove": {
    input: accountIdInputSchema,
    output: z.object({ removed: z.boolean() }).strict(),
  },
  "account.enable": {
    input: accountIdInputSchema,
    output: z.object({ account: accountSchema.nullable() }).strict(),
  },
  "account.disable": {
    input: accountIdInputSchema,
    output: z.object({ account: accountSchema.nullable() }).strict(),
  },
  "login.start": {
    input: z.null(),
    output: loginStartSchema,
  },
  "login.complete": {
    input: loginCompleteInputSchema,
    output: accountSchema,
  },
  status: {
    input: z.null(),
    output: statusSchema,
  },
  "token.rotate": {
    input: tokenRotateInputSchema,
    output: hubTokenSummarySchema,
  },
  "bypass.set": {
    input: bypassInputSchema,
    output: bypassResultSchema,
  },
});

export function createRpcHandlers(
  operations: PoolOperations,
  login: ClaudeOAuthLogin,
) {
  return {
    "account.add": (input: Parameters<PoolOperations["add"]>[0]) =>
      operations.add(input),
    "account.list": () => operations.list(),
    "account.remove": async ({ id }: { id: string }) => ({
      removed: await operations.remove(id),
    }),
    "account.enable": async ({ id }: { id: string }) => ({
      account: await operations.enable(id),
    }),
    "account.disable": async ({ id }: { id: string }) => ({
      account: await operations.disable(id),
    }),
    "login.start": () => login.start(),
    "login.complete": (input: { sessionId: string; pasted: string }) =>
      login.complete(input),
    status: () => operations.status(),
    "token.rotate": ({ machine }: { machine: string }) =>
      operations.rotateToken(machine),
    "bypass.set": ({
      threadId,
      bypassed,
    }: {
      threadId: string;
      bypassed: boolean;
    }) => operations.setBypass(threadId, bypassed),
  };
}
