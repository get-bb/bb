import { defineRpcContract, type PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  accountAddInputSchema,
  accountPoolConfigSchema,
  accountPoolConfigSetInputSchema,
  accountIdInputSchema,
  accountPriorityInputSchema,
  accountReorderInputSchema,
  accountSchema,
  accountSummarySchema,
  bypassInputSchema,
  codexLoginCancelSchema,
  codexLoginPollInputSchema,
  codexLoginPollSchema,
  codexLoginStartSchema,
  hubTokenSummarySchema,
  loginCompleteInputSchema,
  loginStartSchema,
  routedThreadStatusListSchema,
  statusSchema,
  tokenRotateInputSchema,
  routingSetInputSchema,
  type AccountPoolConfigController,
} from "./contracts.js";
import type { PoolOperations } from "./operations.js";
import type { ClaudeOAuthLogin } from "./oauth-login.js";
import type { CodexDeviceLogin } from "./codex-device-login.js";

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
  "account.setPriority": {
    input: accountPriorityInputSchema,
    output: z.object({ account: accountSchema.nullable() }).strict(),
  },
  "account.reorder": {
    input: accountReorderInputSchema,
    output: z.null(),
  },
  "account.refreshUsage": {
    input: z.object({ accountId: z.string().uuid() }).strict(),
    output: z.object({ account: accountSummarySchema.nullable() }).strict(),
  },
  "routing.set": {
    input: routingSetInputSchema,
    output: z
      .object({ provider: z.enum(["claude", "codex"]), enabled: z.boolean() })
      .strict(),
  },
  "config.get": {
    input: z.null(),
    output: accountPoolConfigSchema,
  },
  "config.set": {
    input: accountPoolConfigSetInputSchema,
    output: accountPoolConfigSchema,
  },
  "login.start": {
    input: z.null(),
    output: loginStartSchema,
  },
  "login.complete": {
    input: loginCompleteInputSchema,
    output: accountSchema,
  },
  "codexLogin.start": {
    input: z.null(),
    output: codexLoginStartSchema,
  },
  "codexLogin.poll": {
    input: codexLoginPollInputSchema,
    output: codexLoginPollSchema,
  },
  "codexLogin.cancel": {
    input: codexLoginPollInputSchema,
    output: codexLoginCancelSchema,
  },
  "status.get": {
    input: z.null(),
    output: statusSchema,
  },
  "status.routedThreads": {
    input: z.null(),
    output: routedThreadStatusListSchema,
  },
  "token.rotate": {
    input: tokenRotateInputSchema,
    output: hubTokenSummarySchema,
  },
  "bypass.set": {
    input: bypassInputSchema,
    output: bypassInputSchema,
  },
});

export function createRpcHandlers(
  operations: PoolOperations,
  login: ClaudeOAuthLogin,
  codexLogin: CodexDeviceLogin,
  config: AccountPoolConfigController,
): PluginRpcHandlers<typeof accountPoolRpcContract> {
  return {
    "account.add": (input) => operations.add(input),
    "account.list": () => operations.list(),
    "account.remove": async ({ id }) => ({
      removed: await operations.remove(id),
    }),
    "account.enable": async ({ id }) => ({
      account: await operations.enable(id),
    }),
    "account.disable": async ({ id }) => ({
      account: await operations.disable(id),
    }),
    "account.setPriority": async ({ accountId, priority }) => ({
      account: await operations.setPriority(accountId, priority),
    }),
    "account.refreshUsage": async ({ accountId }) => ({
      account: await operations.refreshUsage(accountId),
    }),
    "account.reorder": async ({ provider, accountIds }) => {
      await operations.reorder(provider, accountIds);
      return null;
    },
    "routing.set": async ({ provider, enabled }) => {
      await operations.setRouting(provider, enabled);
      return { provider, enabled };
    },
    "config.get": () => config.get(),
    "config.set": (input) => config.set(input),
    "login.start": () => login.start(),
    "login.complete": (input) => login.complete(input),
    "codexLogin.start": () => codexLogin.start(),
    "codexLogin.poll": (input) => codexLogin.poll(input),
    "codexLogin.cancel": (input) => ({
      cancelled: codexLogin.cancel(input),
    }),
    "status.get": () => operations.status(),
    "status.routedThreads": () => operations.routedThreadsWithoutLocalLogin(),
    "token.rotate": ({ machine }) => operations.rotateToken(machine),
    "bypass.set": ({ threadId, bypassed }) =>
      operations.setBypass(threadId, bypassed),
  };
}
