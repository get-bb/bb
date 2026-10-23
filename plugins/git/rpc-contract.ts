import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { gitBranchNameSchema, isValidGitBranchName } from "@bb/domain";
import { diffViewedFileSchema } from "@bb/server-contract";
import {
  GIT_DIFF_MAX_DIFF_BYTES,
  GIT_DIFF_MAX_FILE_LIST_BYTES,
  GIT_PATCHES_MAX_KEYS,
  GIT_STATUS_MAX_KEYS,
  GIT_VIEWED_MAX_PATHS,
  gitDiffResultSchema,
  gitFileSideQuerySchema,
  gitFileSideResultSchema,
  gitFilesResultSchema,
  gitFilesTag,
  gitPatchResultSchema,
  gitRefsTag,
  gitStatusResultSchema,
  gitStatusRowSchema,
  gitStatusTag,
  gitViewedTag,
  workspaceDiffTargetSchema,
} from "./contract.js";
import {
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  gitBranchOptionsSchema,
} from "bb-environment-provider-host/git-types";

const gitDiffQuerySchema = workspaceDiffTargetSchema.refine(
  (target) =>
    !("mergeBaseBranch" in target) ||
    isValidGitBranchName(target.mergeBaseBranch),
  { message: "Invalid git branch name" },
);

const environmentInputSchema = z
  .object({ environmentId: z.string().min(1) })
  .strict();

export const gitRpcContract = defineRpcContract({
  status: {
    experimental_description:
      "Git status of each environment's workspace, keyed by environment id. Branch comparison uses the environment's merge base.",
    input: z
      .object({
        keys: z.array(z.string().min(1)).min(1).max(GIT_STATUS_MAX_KEYS),
      })
      .strict(),
    output: z.record(z.string(), gitStatusRowSchema),
    keyTags: (key) => [gitStatusTag(key)],
  },
  workspaceStatus: {
    experimental_description:
      "Git status of one environment's workspace, compared with mergeBaseBranch when given.",
    input: environmentInputSchema
      .extend({ mergeBaseBranch: gitBranchNameSchema.optional() })
      .strict(),
    output: gitStatusResultSchema,
    tags: ({ environmentId }) => [gitStatusTag(environmentId)],
  },
  diff: {
    experimental_description:
      "The unified diff, file list and shortstat for one environment and target.",
    input: environmentInputSchema
      .extend({
        target: gitDiffQuerySchema,
        maxDiffBytes: z
          .number()
          .int()
          .min(1)
          .max(GIT_DIFF_MAX_DIFF_BYTES)
          .optional(),
        maxFileListBytes: z
          .number()
          .int()
          .min(1)
          .max(GIT_DIFF_MAX_FILE_LIST_BYTES)
          .optional(),
      })
      .strict(),
    output: gitDiffResultSchema,
    tags: ({ environmentId }) => [gitFilesTag(environmentId)],
  },
  files: {
    experimental_description:
      "Changed files with per-file line counts for one environment and target, with patches for small files.",
    input: environmentInputSchema
      .extend({
        target: gitDiffQuerySchema,
        ignoreWhitespace: z.boolean(),
      })
      .strict(),
    output: gitFilesResultSchema,
    tags: ({ environmentId }) => [gitFilesTag(environmentId)],
  },
  patches: {
    experimental_description:
      "One file's patch per key. Build keys with the contract's gitPatchKey from a files entry's path and revision.",
    input: z
      .object({
        keys: z.array(z.string().min(1)).min(1).max(GIT_PATCHES_MAX_KEYS),
      })
      .strict(),
    output: z.record(z.string(), gitPatchResultSchema),
    keyTags: () => [],
  },
  fileSide: {
    experimental_description:
      "The old or new side of one changed file, for expanding diff context.",
    input: environmentInputSchema
      .extend({ query: gitFileSideQuerySchema })
      .strict(),
    output: gitFileSideResultSchema,
  },
  branches: {
    experimental_description:
      "Local and remote branches to compare an environment against.",
    input: environmentInputSchema
      .extend({
        query: z.string().max(BRANCH_LIST_QUERY_MAX_LENGTH).optional(),
        limit: z.number().int().min(1).max(BRANCH_LIST_LIMIT_MAX).optional(),
        selectedBranch: gitBranchNameSchema.optional(),
      })
      .strict(),
    output: gitBranchOptionsSchema,
    tags: ({ environmentId }) => [gitRefsTag(environmentId)],
  },
  viewed: {
    experimental_description:
      "Files marked Viewed for an environment and diff target.",
    input: environmentInputSchema
      .extend({
        target: gitDiffQuerySchema,
        paths: z
          .array(z.string().min(1).max(4096))
          .max(GIT_VIEWED_MAX_PATHS)
          .optional(),
      })
      .strict(),
    output: z.object({ files: z.array(diffViewedFileSchema) }).strict(),
    tags: ({ environmentId }) => [gitViewedTag(environmentId)],
  },
  markViewed: {
    experimental_description:
      "Mark a file Viewed at a revision returned by files.",
    input: environmentInputSchema
      .extend({
        target: gitDiffQuerySchema,
        path: z.string().min(1).max(4096),
        revision: z.string().min(1).max(1024),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    invalidates: ({ environmentId }) => [gitViewedTag(environmentId)],
  },
  clearViewed: {
    experimental_description:
      "Clear one file's Viewed mark, or every mark for the target.",
    input: environmentInputSchema
      .extend({
        target: gitDiffQuerySchema,
        path: z.string().min(1).max(4096).optional(),
      })
      .strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    invalidates: ({ environmentId }) => [gitViewedTag(environmentId)],
  },
  setMergeBase: {
    experimental_description:
      "Compare an environment against a branch, or null for its default.",
    input: environmentInputSchema
      .extend({ mergeBaseBranch: gitBranchNameSchema.nullable() })
      .strict(),
    output: z.discriminatedUnion("ok", [
      z.object({ ok: z.literal(true) }).strict(),
      z
        .object({
          ok: z.literal(false),
          environmentStatus: z.enum([
            "creating",
            "provisioning",
            "ready",
            "error",
            "destroyed",
          ]),
        })
        .strict(),
    ]),
    invalidates: ({ environmentId }) => [gitStatusTag(environmentId)],
  },
  refresh: {
    experimental_description:
      "Drop an environment's cached git reads and refresh every view of them, for example after a commit.",
    input: environmentInputSchema,
    output: z.object({ ok: z.literal(true) }).strict(),
  },
});
