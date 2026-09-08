import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

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
  resolvePath: {
    input: z.object({ pathKey: z.string().min(1) }).strict(),
    output: z.object({ path: z.string().min(1) }).strict(),
  },
  create: {
    input: z
      .object({
        sourcePath: z.string().min(1),
        pathKey: z.string().min(1),
        branchName: z.string().min(1),
        copy: z.enum(["all", "filtered"]),
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
        pathKey: z.string().min(1),
        path: z.string().min(1).nullable(),
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
