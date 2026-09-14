import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  commitDetailOutputSchema,
  commitHashSchema,
  filePatchOutputSchema,
  historyOutputSchema,
  historyRefSchema,
  repoRelPathSchema,
  repoStatusOutputSchema,
  hostScanOutputSchema,
  historyPageArgsSchema,
  relativeFilePathSchema,
} from "./git/schemas.js";

export {
  commitHashSchema,
  repoRelPathSchema,
  gitRefSchema,
  gitRefKindSchema,
  repoSummarySchema,
  historyCommitSchema,
  fileChangeSchema,
  branchRefSchema,
  historyRefSchema,
} from "./git/schemas.js";
export type {
  GitRef,
  GitRefKind,
  RepoSummary,
  HistoryCommit,
  FileChange,
  BranchRef,
  RepoStatusOutput,
  HistoryOutput,
  CommitDetailOutput,
  FilePatchOutput,
  HostScanOutput,
} from "./git/schemas.js";

const sourceSummarySchema = z
  .object({
    id: z.string(),
    path: z.string(),
    hostId: z.string(),
    hostName: z.string(),
    isDefault: z.boolean(),
  })
  .strict();
export type SourceSummary = z.infer<typeof sourceSummarySchema>;

export const projectsOutputSchema = z
  .object({
    projects: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          sources: z.array(sourceSummarySchema),
        })
        .strict(),
    ),
  })
  .strict();
export type ProjectsOutput = z.infer<typeof projectsOutputSchema>;

export const overviewOutputSchema = z
  .object({
    source: sourceSummarySchema,
    repos: hostScanOutputSchema.shape.repos,
    scanTruncated: z.boolean(),
    scanError: z.string().nullable(),
  })
  .strict();
export type OverviewOutput = z.infer<typeof overviewOutputSchema>;

const sourceScopedInputSchema = z
  .object({
    projectId: z.string().min(1),
    sourceId: z.string().min(1).optional(),
  })
  .strict();

export const gitGraphRpcContract = defineRpcContract({
  projects: {
    input: z.null(),
    output: projectsOutputSchema,
  },
  overview: {
    input: sourceScopedInputSchema.extend({
      refresh: z.boolean().optional(),
    }),
    output: overviewOutputSchema,
  },
  repoStatus: {
    input: sourceScopedInputSchema.extend({
      repoRelPath: repoRelPathSchema,
    }),
    output: repoStatusOutputSchema,
  },
  history: {
    input: sourceScopedInputSchema
      .extend({ repoRelPath: repoRelPathSchema })
      .extend(historyPageArgsSchema.shape)
      .extend({
        refs: z.array(historyRefSchema).max(64).default([]),
        includeRemotes: z.boolean().optional(),
      }),
    output: historyOutputSchema,
  },
  commitDetail: {
    input: sourceScopedInputSchema.extend({
      repoRelPath: repoRelPathSchema,
      hash: commitHashSchema,
    }),
    output: commitDetailOutputSchema,
  },
  filePatch: {
    input: sourceScopedInputSchema.extend({
      repoRelPath: repoRelPathSchema,
      hash: commitHashSchema,
      path: relativeFilePathSchema,
    }),
    output: filePatchOutputSchema,
  },
});
