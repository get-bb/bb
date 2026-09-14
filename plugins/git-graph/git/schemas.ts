import { z } from "zod";

export const repoRelPathSchema = z.string().max(1024);
export const commitHashSchema = z
  .string()
  .regex(/^[0-9a-f]{4,40}$/u, "must be a commit hash");
export const relativeFilePathSchema = z.string().min(1).max(2048);

export const gitRefKindSchema = z.enum([
  "branch",
  "remote",
  "tag",
  "stash",
  "other",
]);
export type GitRefKind = z.infer<typeof gitRefKindSchema>;

export const gitRefSchema = z
  .object({
    name: z.string(),
    kind: gitRefKindSchema,
    isHead: z.boolean(),
  })
  .strict();
export type GitRef = z.infer<typeof gitRefSchema>;

export const repoSummarySchema = z
  .object({
    relPath: z.string(),
    position: z.enum(["root", "nested", "enclosing"]),
    gitLink: z.enum(["direct", "worktree", "submodule"]),
    head: z
      .object({
        abbrev: z.string(),
        branch: z.string().nullable(),
        detached: z.boolean(),
      })
      .nullable(),
    empty: z.boolean(),
    error: z.string().nullable(),
  })
  .strict();
export type RepoSummary = z.infer<typeof repoSummarySchema>;

export const historyCommitSchema = z
  .object({
    hash: z.string(),
    abbrev: z.string(),
    parents: z.array(z.string()),
    subject: z.string(),
    authorName: z.string(),
    authorEmail: z.string(),
    authorDate: z.string(),
    refs: z.array(gitRefSchema),
  })
  .strict();
export type HistoryCommit = z.infer<typeof historyCommitSchema>;

export const fileChangeSchema = z
  .object({
    path: z.string(),
    status: z.enum([
      "added",
      "modified",
      "deleted",
      "renamed",
      "copied",
      "type-change",
      "unmerged",
      "unknown",
    ]),
    oldPath: z.string().nullable(),
  })
  .strict();
export type FileChange = z.infer<typeof fileChangeSchema>;

export const branchRefSchema = z
  .object({
    fullName: z.string().regex(/^refs\/(heads|remotes)\/[^\s]+$/u),
    shortName: z.string().min(1),
    isRemote: z.boolean(),
    isHead: z.boolean(),
  })
  .strict();
export type BranchRef = z.infer<typeof branchRefSchema>;

export const historyRefSchema = z
  .string()
  .regex(
    /^refs\/(heads|remotes)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u,
    "must be a known branch ref",
  )
  .refine((value) => !value.includes(".."), "must not contain ..")
  .refine(
    (value) => !/\/HEAD$/u.test(value),
    "remote HEAD aliases are not selectable",
  );

export const repoStatusOutputSchema = z
  .object({
    dirty: z
      .object({
        staged: z.number().int().nonnegative(),
        unstaged: z.number().int().nonnegative(),
        untracked: z.number().int().nonnegative(),
        conflicted: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        truncated: z.boolean(),
      })
      .nullable(),
    branches: z.array(branchRefSchema),
    branchCount: z.number().int().nonnegative(),
    tagCount: z.number().int().nonnegative(),
    remoteRefCount: z.number().int().nonnegative(),
    error: z.string().nullable(),
  })
  .strict();
export type RepoStatusOutput = z.infer<typeof repoStatusOutputSchema>;

export const historyOutputSchema = z
  .object({
    commits: z.array(historyCommitSchema),
    empty: z.boolean(),
  })
  .strict();
export type HistoryOutput = z.infer<typeof historyOutputSchema>;

export const commitDetailOutputSchema = z
  .object({
    commit: z
      .object({
        hash: z.string(),
        abbrev: z.string(),
        tree: z.string(),
        parents: z.array(
          z
            .object({
              hash: z.string(),
              abbrev: z.string(),
              subject: z.string(),
            })
            .strict(),
        ),
        author: z
          .object({
            name: z.string(),
            email: z.string(),
            date: z.string(),
          })
          .strict(),
        committer: z
          .object({
            name: z.string(),
            email: z.string(),
            date: z.string(),
          })
          .strict(),
        message: z.string(),
        refs: z.array(gitRefSchema),
        isMerge: z.boolean(),
        isRoot: z.boolean(),
      })
      .strict(),
    files: z.array(fileChangeSchema),
    filesNote: z.string().nullable(),
  })
  .strict();
export type CommitDetailOutput = z.infer<typeof commitDetailOutputSchema>;

export const filePatchOutputSchema = z
  .object({
    patch: z.string(),
    truncated: z.boolean(),
  })
  .strict();
export type FilePatchOutput = z.infer<typeof filePatchOutputSchema>;

export const hostScanOutputSchema = z
  .object({
    repos: z.array(repoSummarySchema),
    scanTruncated: z.boolean(),
    scanError: z.string().nullable(),
  })
  .strict();
export type HostScanOutput = z.infer<typeof hostScanOutputSchema>;

export const historyPageArgsSchema = z
  .object({
    offset: z.number().int().min(0).max(1_000_000),
    limit: z.number().int().min(1).max(300),
    query: z.string().max(200).optional(),
  })
  .strict();
