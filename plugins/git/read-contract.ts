import { lifecycleApiErrorSchema } from "@bb/server-contract";
import { z } from "zod";
import {
  threadGitDiffResponseSchema,
  workspaceDiffTargetSchema,
  workspaceStatusSchema,
} from "bb-git-contract";
import { workspaceResolutionFailureSchema } from "bb-git-contract";

export const gitLifecycleStatusSchema = z.literal([
  400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414,
  415, 416, 417, 418, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451, 500,
  501, 502, 503, 504, 505, 506, 507, 508, 510, 511,
]);
export const gitReadFailureSchema = z.union([
  workspaceResolutionFailureSchema,
  z
    .object({
      kind: z.literal("lifecycle"),
      status: gitLifecycleStatusSchema,
      error: lifecycleApiErrorSchema,
      message: z.string(),
    })
    .strict(),
]);
export type GitReadFailure = z.infer<typeof gitReadFailureSchema>;

export const environmentDiffFileResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  contentEncoding: z.enum(["base64", "utf8"]),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().nonnegative(),
});
export type EnvironmentDiffFileResponse = z.infer<
  typeof environmentDiffFileResponseSchema
>;

export const environmentWorkspaceNotApplicableReasonSchema = z.enum([
  "non_git_environment",
]);

const environmentWorkspaceNotApplicableOutcomeSchema = z
  .object({
    outcome: z.literal("not_applicable"),
    reason: environmentWorkspaceNotApplicableReasonSchema,
    message: z.string().min(1),
  })
  .strict();

export const environmentStatusResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      workspace: workspaceStatusSchema,
    })
    .strict(),
  environmentWorkspaceNotApplicableOutcomeSchema,
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: gitReadFailureSchema,
    })
    .strict(),
]);

export const environmentDiffResponseSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("available"),
      diff: threadGitDiffResponseSchema,
    })
    .strict(),
  environmentWorkspaceNotApplicableOutcomeSchema,
  z
    .object({
      outcome: z.literal("unavailable"),
      failure: gitReadFailureSchema,
    })
    .strict(),
]);
export type EnvironmentDiffResponse = z.infer<
  typeof environmentDiffResponseSchema
>;

export const gitDiffFileChangeKindSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type_changed",
]);
export type GitDiffFileChangeKind = z.infer<typeof gitDiffFileChangeKindSchema>;

export function letterToChangeKind({
  letter,
}: {
  letter: string;
}): GitDiffFileChangeKind {
  switch (letter) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type_changed";
    default:
      throw new Error(`Unrecognized git name-status letter: ${letter}`);
  }
}

export const DIFF_PATCH_MAX_PATHS_PER_REQUEST = 50;

export const diffFileEntrySchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  changeKind: gitDiffFileChangeKindSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  origin: z.enum(["tracked", "untracked"]),
  loadMode: z.enum(["auto", "on_demand", "too_large"]),
  revision: z.string().min(1),
});
export type DiffFileEntry = z.infer<typeof diffFileEntrySchema>;

export const diffPatchEntrySchema = z.object({
  path: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
});
export type DiffPatchEntry = z.infer<typeof diffPatchEntrySchema>;

export const environmentDiffFilesResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("available"),
        files: z.array(diffFileEntrySchema),
        truncated: z.boolean(),
        shortstat: z.string(),
        mergeBaseRef: z.string().nullable(),
        initialPatches: z.array(diffPatchEntrySchema),
      })
      .strict(),
    environmentWorkspaceNotApplicableOutcomeSchema,
    z
      .object({
        outcome: z.literal("unavailable"),
        failure: gitReadFailureSchema,
      })
      .strict(),
  ],
);
export type EnvironmentDiffFilesResponse = z.infer<
  typeof environmentDiffFilesResponseSchema
>;

export const environmentDiffPatchResponseSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("available"),
        patches: z.array(diffPatchEntrySchema),
      })
      .strict(),
    environmentWorkspaceNotApplicableOutcomeSchema,
    z
      .object({
        outcome: z.literal("unavailable"),
        failure: gitReadFailureSchema,
      })
      .strict(),
  ],
);
export type EnvironmentDiffPatchResponse = z.infer<
  typeof environmentDiffPatchResponseSchema
>;

export const environmentDiffPatchRequestSchema = z
  .object({
    target: workspaceDiffTargetSchema,
    paths: z
      .array(z.string().min(1))
      .min(1)
      .max(DIFF_PATCH_MAX_PATHS_PER_REQUEST),
    ignoreWhitespace: z.boolean().optional(),
  })
  .strict();
export type EnvironmentDiffPatchRequest = z.infer<
  typeof environmentDiffPatchRequestSchema
>;

export const diffViewedFileSchema = z
  .object({
    path: z.string().min(1),
    revision: z.string().min(1),
  })
  .strict();
export type DiffViewedFile = z.infer<typeof diffViewedFileSchema>;

export const environmentDiffViewedResponseSchema = z
  .object({
    files: z.array(diffViewedFileSchema),
  })
  .strict();
export type EnvironmentDiffViewedResponse = z.infer<
  typeof environmentDiffViewedResponseSchema
>;

export type EnvironmentStatusResponse = z.infer<
  typeof environmentStatusResponseSchema
>;
