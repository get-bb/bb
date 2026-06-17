import { z } from "zod";

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

/**
 * Raw per-file diff stat the daemon computes from `git diff --numstat` +
 * `--name-status -M`, with no patch text. One entry per changed file; this is
 * the table-of-contents row the paginated diff tab fetches before any patch.
 *
 * Lives in @bb/domain (not host-workspace) because the host-daemon-contract RPC
 * result schema validates it and cannot import host-workspace.
 *
 * - `statusLetter` is git's raw `--name-status` letter; the server maps it to
 *   the product change kind.
 * - `previousPath` is the rename/copy source for `R`/`C`; `null` otherwise.
 * - `additions`/`deletions` come from `--numstat`; binary files report `0` and
 *   set `binary: true`.
 * - `origin` distinguishes working-tree untracked files (which require the
 *   `--no-index` patch form) from tracked files.
 */
export const rawDiffFileStatSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  statusLetter: z.enum(["A", "M", "D", "R", "C", "T"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
  origin: z.enum(["tracked", "untracked"]),
});
export type RawDiffFileStat = z.infer<typeof rawDiffFileStatSchema>;

export const threadGitDiffResponseSchema = z.object({
  diff: z.string(),
  truncated: z.boolean(),
  shortstat: z.string(),
  files: z.string(),
  /**
   * Resolved merge-base SHA for `branch_committed` / `all` targets — the
   * exact ref the diff was computed against. `null` for targets that don't
   * use a merge-base (`uncommitted`, `commit`), and also when no merge-base
   * exists (e.g. the branch has been removed locally). Callers fetching
   * per-file content for context expansion must pass this SHA as the
   * "old side" ref so the file content lines up with the diff's hunk
   * coordinates — passing the branch name reads from its current tip, which
   * may have diverged past the merge-base.
   */
  mergeBaseRef: z.string().nullable(),
});
export type ThreadGitDiffResponse = z.infer<typeof threadGitDiffResponseSchema>;
