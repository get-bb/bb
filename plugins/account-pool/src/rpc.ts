import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  accountAddInputSchema,
  accountIdInputSchema,
  accountSchema,
  accountSummarySchema,
  statusSchema,
} from "./contracts.js";
import type { PoolOperations } from "./operations.js";

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
  status: {
    input: z.null(),
    output: statusSchema,
  },
});

export function createRpcHandlers(operations: PoolOperations) {
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
    status: () => operations.status(false),
  };
}
