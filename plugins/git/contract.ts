import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  BRANCH_LIST_LIMIT_MAX,
  BRANCH_LIST_QUERY_MAX_LENGTH,
  gitBranchOptionsSchema,
  gitCheckoutRefSchema,
  workspaceResolutionFailureSchema,
} from "bb-environment-provider-host/git-types";

export const gitObjectIdSchema = z.string().regex(/^[0-9a-f]{4,40}$/iu);

export const workspaceDiffTargetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("uncommitted"),
  }),
  z.object({
    type: z.literal("branch_committed"),
    mergeBaseBranch: z.string().min(1),
  }),
  z.object({
    type: z.literal("all"),
    mergeBaseBranch: z.string().min(1),
  }),
  z.object({
    type: z.literal("commit"),
    sha: z.string().regex(/^[0-9a-f]{4,40}$/iu),
  }),
]);
export type WorkspaceDiffTarget = z.infer<typeof workspaceDiffTargetSchema>;

export const rawDiffFileStatSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  statusLetter: z.enum(["A", "M", "D", "R", "C", "T"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  origin: z.enum(["tracked", "untracked"]),
  revision: z.string().min(1),
});
export type RawDiffFileStat = z.infer<typeof rawDiffFileStatSchema>;

export const threadGitDiffResponseSchema = z.object({
  diff: z.string(),
  truncated: z.boolean(),
  shortstat: z.string(),
  files: z.string(),
  mergeBaseRef: z.string().nullable(),
});
export type ThreadGitDiffResponse = z.infer<typeof threadGitDiffResponseSchema>;

export const gitDiffFileChangeKindSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type_changed",
]);
export type GitDiffFileChangeKind = z.infer<typeof gitDiffFileChangeKindSchema>;

const workspaceStateValues = [
  "clean",
  "untracked",
  "dirty_uncommitted",
  "committed_unmerged",
  "dirty_and_committed_unmerged",
] as const;
const workspaceStateSchema = z.enum(workspaceStateValues);

const workspaceFileStatusKindSchema = z.enum([
  "M",
  "A",
  "D",
  "R",
  "C",
  "U",
  "??",
  "?",
]);
export type WorkspaceFileStatusKind = z.infer<
  typeof workspaceFileStatusKindSchema
>;

const workspaceFileStatusSchema = z.object({
  path: z.string(),
  status: workspaceFileStatusKindSchema,
  insertions: z.number().nullable(),
  deletions: z.number().nullable(),
});
export type WorkspaceFileStatus = z.infer<typeof workspaceFileStatusSchema>;

const workspaceCommitSummarySchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  authorName: z.string(),
  authoredAt: z.number(),
});
export type WorkspaceCommitSummary = z.infer<
  typeof workspaceCommitSummarySchema
>;

const workspaceChangeStatsSchema = z.object({
  insertions: z.number(),
  deletions: z.number(),
  lineStatsComplete: z.boolean(),
  fileCount: z.number().int().nonnegative(),
  files: z.array(workspaceFileStatusSchema),
});

export type WorkspaceChangeStats = z.infer<typeof workspaceChangeStatsSchema>;

const workspaceWorkingTreeSchema = workspaceChangeStatsSchema.extend({
  hasUncommittedChanges: z.boolean(),
  state: workspaceStateSchema,
});
export type WorkspaceWorkingTree = z.infer<typeof workspaceWorkingTreeSchema>;

const workspaceBranchSchema = z.object({
  currentBranch: z.string().nullable(),
  defaultBranch: z.string(),
});

const workspaceMergeBaseSchema = workspaceChangeStatsSchema.extend({
  mergeBaseBranch: z.string(),
  baseRef: z.string().nullable(),
  aheadCount: z.number(),
  behindCount: z.number(),
  squashMergeCheckComplete: z.boolean(),
  hasCommittedUnmergedChanges: z.boolean(),
  commits: z.array(workspaceCommitSummarySchema),
});
export type WorkspaceMergeBase = z.infer<typeof workspaceMergeBaseSchema>;

export const workspaceStatusSchema = z.object({
  workingTree: workspaceWorkingTreeSchema,
  checkout: gitCheckoutRefSchema,
  branch: workspaceBranchSchema,
  mergeBase: workspaceMergeBaseSchema.nullable(),
});
export type WorkspaceStatus = z.infer<typeof workspaceStatusSchema>;

export const GIT_DIFF_TAB_ID = "diff";
export const GIT_STATUS_MAX_KEYS = 200;
export const GIT_PATCHES_MAX_KEYS = 50;
export const GIT_VIEWED_MAX_PATHS = 500;
export const GIT_DIFF_MAX_DIFF_BYTES = 2 * 1024 * 1024;
export const GIT_DIFF_MAX_FILE_LIST_BYTES = 256 * 1024;

export function gitStatusTag(environmentId: string): string {
  return `status:${environmentId}`;
}

export function gitFilesTag(environmentId: string): string {
  return `files:${environmentId}`;
}

export function gitRefsTag(environmentId: string): string {
  return `refs:${environmentId}`;
}

export function gitViewedTag(environmentId: string): string {
  return `viewed:${environmentId}`;
}

const notApplicableSchema = z
  .object({
    outcome: z.literal("not_applicable"),
    reason: z.literal("non_git_environment"),
    message: z.string().min(1),
  })
  .strict();

const unavailableSchema = z
  .object({
    outcome: z.literal("unavailable"),
    failure: workspaceResolutionFailureSchema,
  })
  .strict();

export const gitStatusResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("available"), workspace: workspaceStatusSchema })
    .strict(),
  notApplicableSchema,
  unavailableSchema,
]);
export type GitStatusResult = z.infer<typeof gitStatusResultSchema>;

export const gitStatusRowSchema = z.discriminatedUnion("outcome", [
  ...gitStatusResultSchema.options,
  z
    .object({ outcome: z.literal("failed"), message: z.string().min(1) })
    .strict(),
]);
export type GitStatusRow = z.infer<typeof gitStatusRowSchema>;

export const gitDiffResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("available"), diff: threadGitDiffResponseSchema })
    .strict(),
  notApplicableSchema,
  unavailableSchema,
]);
export type GitDiffResult = z.infer<typeof gitDiffResultSchema>;

export const diffFileEntrySchema = z
  .object({
    path: z.string(),
    previousPath: z.string().nullable(),
    changeKind: gitDiffFileChangeKindSchema,
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
    origin: z.enum(["tracked", "untracked"]),
    loadMode: z.enum(["auto", "on_demand", "too_large"]),
    revision: z.string().min(1),
  })
  .strict();
export type DiffFileEntry = z.infer<typeof diffFileEntrySchema>;

export const diffPatchEntrySchema = z
  .object({
    path: z.string(),
    patch: z.string(),
    truncated: z.boolean(),
  })
  .strict();
export type DiffPatchEntry = z.infer<typeof diffPatchEntrySchema>;

const gitFilesSchema = z
  .object({
    files: z.array(diffFileEntrySchema),
    truncated: z.boolean(),
    shortstat: z.string(),
    mergeBaseRef: z.string().nullable(),
    initialPatches: z.array(diffPatchEntrySchema),
  })
  .strict();

export const gitFilesResultSchema = z.discriminatedUnion("outcome", [
  gitFilesSchema.extend({ outcome: z.literal("available") }),
  notApplicableSchema,
  unavailableSchema,
]);
export type GitFilesResult = z.infer<typeof gitFilesResultSchema>;

export const gitPatchResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("available"), patch: diffPatchEntrySchema })
    .strict(),
  notApplicableSchema,
  unavailableSchema,
]);
export type GitPatchResult = z.infer<typeof gitPatchResultSchema>;

export const gitPatchKeySchema = z
  .object({
    environmentId: z.string().min(1),
    target: workspaceDiffTargetSchema,
    ignoreWhitespace: z.boolean(),
    path: z.string().min(1),
    revision: z.string().min(1),
  })
  .strict();
export type GitPatchKey = z.infer<typeof gitPatchKeySchema>;

export function gitPatchKey(key: GitPatchKey): string {
  return JSON.stringify([
    key.environmentId,
    key.target,
    key.ignoreWhitespace,
    key.path,
    key.revision,
  ]);
}

const patchKeyTupleSchema = z.tuple([
  z.string().min(1),
  workspaceDiffTargetSchema,
  z.boolean(),
  z.string().min(1),
  z.string().min(1),
]);

export function parseGitPatchKey(key: string): GitPatchKey | null {
  let raw: unknown;
  try {
    raw = JSON.parse(key);
  } catch {
    return null;
  }
  const parsed = patchKeyTupleSchema.safeParse(raw);
  if (!parsed.success) return null;
  const [environmentId, target, ignoreWhitespace, path, revision] = parsed.data;
  return { environmentId, target, ignoreWhitespace, path, revision };
}

export const gitDiffTabTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("commit"), sha: z.string().min(1) }).strict(),
]);
export type GitDiffTabTarget = z.infer<typeof gitDiffTabTargetSchema>;

const diffFileSideSchema = z.enum(["old", "new"]);

const fileSideShape = { path: z.string().min(1), side: diffFileSideSchema };

export const gitFileSideQuerySchema = z.discriminatedUnion("target", [
  z.object({ target: z.literal("uncommitted"), ...fileSideShape }).strict(),
  z
    .object({
      target: z.enum(["branch_committed", "all"]),
      mergeBaseRef: gitObjectIdSchema,
      ...fileSideShape,
    })
    .strict(),
  z
    .object({ target: z.literal("commit"), sha: gitObjectIdSchema, ...fileSideShape })
    .strict(),
]);
export type GitFileSideQuery = z.infer<typeof gitFileSideQuerySchema>;

export const gitFileContentSchema = z
  .object({
    path: z.string(),
    content: z.string(),
    contentEncoding: z.enum(["base64", "utf8"]),
    mimeType: z.string().optional(),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();
export type GitFileContent = z.infer<typeof gitFileContentSchema>;

export const gitFileSideResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("available"), file: gitFileContentSchema })
    .strict(),
  z
    .object({
      outcome: z.literal("unavailable"),
      code: z.enum(["ENOENT", "invalid_path", "file_too_large"]),
      message: z.string(),
    })
    .strict(),
]);
export type GitFileSideResult = z.infer<typeof gitFileSideResultSchema>;

export const hostReadResultSchema = <T extends z.ZodType>(available: T) =>
  z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("available"), value: available }).strict(),
    unavailableSchema,
  ]);

const hostPathSchema = z.object({ path: z.string().min(1) }).strict();

const hostReadFreshnessSchema = z
  .object({ work: z.string().min(1), refs: z.string().min(1) })
  .strict();

export type GitReadFreshness = z.infer<typeof hostReadFreshnessSchema>;

export const gitHostContract = defineRpcContract({
  status: {
    experimental_retryable: true,
    input: hostPathSchema
      .extend({
        freshness: hostReadFreshnessSchema,
        mergeBaseBranch: z.string().min(1).optional(),
      })
      .strict(),
    output: hostReadResultSchema(workspaceStatusSchema),
  },
  diff: {
    experimental_retryable: true,
    input: hostPathSchema
      .extend({
        freshness: hostReadFreshnessSchema,
        target: workspaceDiffTargetSchema,
        maxDiffBytes: z.number().int().min(1).max(GIT_DIFF_MAX_DIFF_BYTES),
        maxFileListBytes: z
          .number()
          .int()
          .min(1)
          .max(GIT_DIFF_MAX_FILE_LIST_BYTES),
      })
      .strict(),
    output: hostReadResultSchema(threadGitDiffResponseSchema),
  },
  files: {
    experimental_retryable: true,
    input: hostPathSchema
      .extend({
        freshness: hostReadFreshnessSchema,
        target: workspaceDiffTargetSchema,
        ignoreWhitespace: z.boolean(),
      })
      .strict(),
    output: hostReadResultSchema(gitFilesSchema),
  },
  patches: {
    experimental_retryable: true,
    input: hostPathSchema
      .extend({
        freshness: hostReadFreshnessSchema,
        target: workspaceDiffTargetSchema,
        ignoreWhitespace: z.boolean(),
        paths: z.array(z.string().min(1)).min(1).max(GIT_PATCHES_MAX_KEYS),
      })
      .strict(),
    output: hostReadResultSchema(
      z
        .object({
          patches: z.array(diffPatchEntrySchema),
          deferred: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  },
  branches: {
    experimental_retryable: true,
    input: hostPathSchema
      .extend({
        query: z.string().max(BRANCH_LIST_QUERY_MAX_LENGTH).optional(),
        limit: z.number().int().min(1).max(BRANCH_LIST_LIMIT_MAX),
        selectedBranch: z.string().min(1).optional(),
      })
      .strict(),
    output: gitBranchOptionsSchema,
  },
});
