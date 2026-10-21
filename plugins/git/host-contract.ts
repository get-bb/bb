import { z } from "zod";
import { defineRpcContract } from "@get-bb/plugin-sdk";
import {
  gitBranchNameSchema,
  gitBranchOptionsSchema,
  workspaceStatusSchema,
  workspaceDiffTargetSchema,
  rawDiffFileStatSchema,
  threadGitDiffResponseSchema,
  workspaceResolutionFailureSchema,
} from "bb-git-contract";
export const unavailableSchema = z
  .object({
    outcome: z.literal("unavailable"),
    failure: workspaceResolutionFailureSchema,
  })
  .strict();
const pathSchema = z.string().min(1);
export const filePathSchema = z
  .string()
  .min(1)
  .max(32768)
  .refine(
    (path) =>
      !path.includes("\u0000") &&
      !path.startsWith("/") &&
      !/^[a-z]:[\\/]/iu.test(path) &&
      !path.split(/[\\/]/u).includes(".."),
    "Expected a workspace-relative file path",
  );
const target = workspaceDiffTargetSchema;
const diffPatchEntrySchema = z
  .object({ path: filePathSchema, patch: z.string(), truncated: z.boolean() })
  .strict();
export const gitHostContract = defineRpcContract({
  branches: {
    input: z
      .object({
        path: pathSchema,
        query: z.string(),
        selectedBranch: gitBranchNameSchema.nullable(),
        limit: z.number().int().positive().max(200),
      })
      .strict(),
    output: gitBranchOptionsSchema,
  },
  status: {
    input: z
      .object({
        path: pathSchema,
        mergeBaseBranch: gitBranchNameSchema.nullable(),
        maxFiles: z.number().int().positive(),
        maxUntrackedLineStatFiles: z.number().int().nonnegative(),
        maxUntrackedLineStatBytes: z.number().int().nonnegative(),
      })
      .strict(),
    output: z.union([workspaceStatusSchema, unavailableSchema]),
  },
  files: {
    input: z
      .object({
        path: pathSchema,
        target,
        ignoreWhitespace: z.boolean(),
        maxFiles: z.number().int().positive(),
      })
      .strict(),
    output: z.union([
      z
        .object({
          files: z.array(rawDiffFileStatSchema),
          shortstat: z.string(),
          mergeBaseRef: z.string().nullable(),
          truncated: z.boolean(),
        })
        .strict(),
      unavailableSchema,
    ]),
  },
  diff: {
    input: z
      .object({
        path: pathSchema,
        target,
        maxDiffBytes: z.number().int().positive(),
        maxFileListBytes: z.number().int().positive(),
        maxUntrackedFiles: z.number().int().positive(),
      })
      .strict(),
    output: z.union([threadGitDiffResponseSchema, unavailableSchema]),
  },
  patches: {
    input: z
      .object({
        path: pathSchema,
        target,
        paths: z.array(filePathSchema).max(50),
        ignoreWhitespace: z.boolean(),
        maxBytesPerFile: z.number().int().positive(),
      })
      .strict(),
    output: z.array(diffPatchEntrySchema),
  },
  watch: {
    input: z.object({ id: z.string().min(1), path: pathSchema }).strict(),
    output: z.null(),
  },
  unwatch: {
    input: z.object({ id: z.string().min(1) }).strict(),
    output: z.null(),
  },
});
export const gitHostSignals = {
  changed: {
    payload: z
      .object({
        id: z.string().min(1),
        paths: z.array(filePathSchema).nullable(),
      })
      .strict(),
  },
};
