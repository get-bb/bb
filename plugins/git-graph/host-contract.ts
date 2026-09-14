import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  commitDetailOutputSchema,
  commitHashSchema,
  filePatchOutputSchema,
  historyOutputSchema,
  historyPageArgsSchema,
  historyRefSchema,
  hostScanOutputSchema,
  relativeFilePathSchema,
  repoRelPathSchema,
  repoStatusOutputSchema,
} from "./git/schemas.js";

const sourceRootSchema = z.string().min(1).max(2048);

const repoScopedInputSchema = z
  .object({
    sourceRoot: sourceRootSchema,
    repoRelPath: repoRelPathSchema,
  })
  .strict();

export const gitGraphHostContract = defineRpcContract({
  scanRepos: {
    input: z.object({ sourceRoot: sourceRootSchema }).strict(),
    output: hostScanOutputSchema,
  },
  repoStatus: {
    input: repoScopedInputSchema,
    output: repoStatusOutputSchema,
  },
  history: {
    input: repoScopedInputSchema.extend(historyPageArgsSchema.shape).extend({
      refs: z.array(historyRefSchema).max(64),
      includeRemotes: z.boolean(),
    }),
    output: historyOutputSchema,
  },
  commitDetail: {
    input: repoScopedInputSchema.extend({
      hash: commitHashSchema,
    }),
    output: commitDetailOutputSchema,
  },
  filePatch: {
    input: repoScopedInputSchema.extend({
      hash: commitHashSchema,
      path: relativeFilePathSchema,
    }),
    output: filePatchOutputSchema,
  },
});
