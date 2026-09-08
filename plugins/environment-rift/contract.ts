import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { environmentHostProgressSchema } from "bb-environment-provider-host/progress";

export const riftBranchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("named"), name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("default") }).strict(),
]);

export const riftHostContract = defineRpcContract({
  availability: {
    input: z.object({}).strict(),
    output: z.object({ installed: z.boolean() }).strict(),
  },
  validate: {
    input: z.object({ sourcePath: z.string().min(1) }).strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("accept") }).strict(),
      z.object({ status: z.literal("refuse"), message: z.string() }).strict(),
    ]),
  },
  create: {
    input: z
      .object({
        operationId: z.string().min(1),
        sourcePath: z.string().min(1),
        pathKey: z.string().min(1),
        branchName: z.string().min(1),
        copy: z.enum(["all", "filtered"]),
        setupTimeoutMs: z.number().int().positive(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("created"),
          path: z.string().min(1),
          mergeBaseBranch: z.string().min(1),
        })
        .strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
  remove: {
    input: z
      .object({
        operationId: z.string().min(1),
        pathKey: z.string().min(1),
        path: z.string().min(1).nullable(),
        teardownTimeoutMs: z.number().int().positive(),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z.object({ status: z.literal("removed") }).strict(),
      z
        .object({ status: z.literal("failed"), message: z.string().min(1) })
        .strict(),
    ]),
  },
});

export const riftHostSignals = {
  progress: {
    payload: environmentHostProgressSchema,
  },
} as const;
