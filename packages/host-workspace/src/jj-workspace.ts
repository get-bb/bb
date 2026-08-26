import {
  WorkspaceError,
  runGit,
  type GitProcessOptions,
} from "./git.js";
import {
  readJjWorkingCopyCommits,
  runJj,
  syncShadowGitCheckout,
  withJjRepoLock,
  type JjWorkspaceLayout,
} from "./jj.js";
import {
  Workspace,
  type CommitOptions,
  type CommitResult,
  type DiffFilesArgs,
  type DiffFilesResult,
  type DiffOptions,
  type DiffPatchArgs,
  type DiffPatchEntry,
  type DiffResult,
  type StatusOptions,
} from "./workspace.js";
import type { WorkspaceStatus } from "@bb/domain";

/**
 * A bb-managed Jujutsu workspace (`jj workspace add`).
 *
 * jj owns the working copy: it snapshots edits into `@` and commits move `@-`.
 * bb reads the workspace through a shadow git worktree registration kept at
 * `@-` (see `attachShadowGitCheckout`), so every git-based read inherited from
 * {@link Workspace} sees exactly what jj sees — uncommitted edits are the
 * difference between `@-` and the files on disk. Only the mutations differ:
 * they go through jj, because a git commit here would strand jj's previous
 * working-copy change as an anonymous head.
 *
 * Reads therefore sync the shadow checkout first. The sync also performs the jj
 * snapshot, so it is what makes on-disk edits visible in the first place.
 */
export class JjWorkspace extends Workspace {
  readonly layout: JjWorkspaceLayout;
  /** jj bookmark this workspace's committed work is published under. */
  readonly bookmark: string;
  /** Login-shell PATH so the daemon can find the jj binary. */
  private readonly jjProcessOptions: GitProcessOptions;

  constructor(args: {
    path: string;
    layout: JjWorkspaceLayout;
    bookmark: string;
    options?: GitProcessOptions;
  }) {
    super(args.path, args.options ?? {});
    this.layout = args.layout;
    this.bookmark = args.bookmark;
    this.jjProcessOptions = args.options ?? {};
  }

  private async sync(): Promise<void> {
    await syncShadowGitCheckout(this.path, this.jjProcessOptions);
  }

  override async getStatus(options: StatusOptions = {}): Promise<WorkspaceStatus> {
    await this.sync();
    return super.getStatus(options);
  }

  override async getDiff(options: DiffOptions = {}): Promise<DiffResult> {
    await this.sync();
    return super.getDiff(options);
  }

  override async diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult> {
    await this.sync();
    return super.diffFiles(args);
  }

  override async diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]> {
    await this.sync();
    return super.diffPatch(args);
  }

  override async getLocalStateFingerprint(): Promise<string> {
    await this.sync();
    return super.getLocalStateFingerprint();
  }

  override async getHeadSha(): Promise<string | null> {
    await this.sync();
    return super.getHeadSha();
  }

  override async listFiles(): Promise<string[]> {
    await this.sync();
    return super.listFiles();
  }

  /**
   * Commits the working copy with jj, then moves this workspace's bookmark to
   * the new commit and exports it so the source repository's git refs — and
   * everything bb reads from them — see the work.
   */
  override async commit(options: CommitOptions): Promise<CommitResult> {
    return withJjRepoLock(this.layout, async () => {
      const before = await readJjWorkingCopyCommits(this.path, this.jjProcessOptions);
      const isEmpty = await this.isWorkingCopyEmpty();
      if (isEmpty) {
        throw new WorkspaceError("no_changes", "No changes to commit");
      }

      // jj has no commit hooks, so noVerify has nothing to switch off here.
      await runJj(["commit", "-m", options.message], { cwd: this.path, ...this.jjProcessOptions });
      const after = await readJjWorkingCopyCommits(this.path, this.jjProcessOptions);
      await runJj(["bookmark", "set", this.bookmark, "-r", after.parent], {
        cwd: this.path,
        ...this.jjProcessOptions,
      });
      await this.exportBookmark(after.parent);
      await this.sync();

      if (after.parent === before.parent) {
        throw new WorkspaceError(
          "jj_command_failed",
          "jj commit did not advance the working-copy parent",
        );
      }
      const commitSubject = (
        await runGit(["log", "-1", "--pretty=%s", after.parent], {
          cwd: this.path,
        })
      ).stdout.trim();
      return { commitSha: after.parent, commitSubject };
    });
  }

  override async reset(): Promise<void> {
    await withJjRepoLock(this.layout, async () => {
      await runJj(["restore"], { cwd: this.path, ...this.jjProcessOptions });
      await this.sync();
    });
  }

  /**
   * The committed work lives at `@-`, which is where the bookmark points once
   * bb has committed. Agents committing with jj directly move `@-` without
   * touching the bookmark, so the commit itself is the honest source.
   */
  protected override async resolveSquashMergeSource(): Promise<string> {
    await this.sync();
    const { parent } = await readJjWorkingCopyCommits(this.path, this.jjProcessOptions);
    return parent;
  }

  private async isWorkingCopyEmpty(): Promise<boolean> {
    const result = await runJj(
      ["log", "--no-graph", "-r", "@", "-T", 'if(empty, "empty", "changed")'],
      { cwd: this.path, ...this.jjProcessOptions },
    );
    return result.stdout.trim() === "empty";
  }

  /**
   * Exports jj bookmarks to the colocated git repository and verifies the ref
   * landed. `jj git export` reports success even when it refuses a bookmark
   * whose git ref moved underneath it, so a mismatch is retried once after
   * importing the git side.
   */
  private async exportBookmark(expectedSha: string): Promise<void> {
    await runJj(["git", "export"], { cwd: this.path, ...this.jjProcessOptions });
    if (await this.bookmarkRefMatches(expectedSha)) {
      return;
    }

    await runJj(["git", "import"], { cwd: this.path, ...this.jjProcessOptions });
    await runJj(["bookmark", "set", this.bookmark, "-r", expectedSha], {
      cwd: this.path,
    });
    await runJj(["git", "export"], { cwd: this.path, ...this.jjProcessOptions });
    if (!(await this.bookmarkRefMatches(expectedSha))) {
      throw new WorkspaceError(
        "jj_export_failed",
        `Could not export bookmark ${this.bookmark} to git`,
      );
    }
  }

  private async bookmarkRefMatches(expectedSha: string): Promise<boolean> {
    const ref = await runGit(
      ["rev-parse", "--verify", `refs/heads/${this.bookmark}`],
      { cwd: this.path, allowFailure: true },
    );
    return ref.exitCode === 0 && ref.stdout.trim() === expectedSha;
  }
}
