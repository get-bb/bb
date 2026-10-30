import { tmpdir } from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  type TestContext,
} from "vitest";
import { initRepo } from "@bb/test-helpers";
import { WorkspaceReads } from "./workspace-reads.js";
import type { WorkspaceChangeStats } from "../contract.js";
import {
  runGit,
  WorkspaceError,
} from "bb-environment-provider-host/workspace-git";

let repositoryTemplate: string;
beforeAll(async () => {
  repositoryTemplate = await fs.mkdtemp(
    path.join(tmpdir(), "bb-reads-template-"),
  );
  await initRepo(repositoryTemplate);
});
afterAll(async () => {
  if (repositoryTemplate)
    await fs.rm(repositoryTemplate, { recursive: true, force: true });
});

async function makeTempDir(
  onTestFinished: TestContext["onTestFinished"],
  prefix: string,
) {
  const directory = await fs.mkdtemp(path.join(tmpdir(), prefix));
  onTestFinished(() =>
    fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    }),
  );
  return directory;
}

async function copyRepository(directory: string) {
  await fs.cp(repositoryTemplate, directory, { recursive: true });
  return directory;
}

const UNLIMITED_DIFF = {
  maxDiffBytes: 64 * 1024 * 1024,
  maxFileListBytes: 64 * 1024 * 1024,
  maxUntrackedFiles: 100_000,
};

let freshReads = 0;
function fresh() {
  freshReads += 1;
  return { work: `work-${freshReads}`, refs: `refs-${freshReads}` };
}

type DiffStats = {
  filesCount: number;
  insertions: number;
  deletions: number;
};

function waitForLockContention(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

function parseFirstIntegerMatch(text: string, pattern: RegExp): number {
  const value = Number.parseInt(text.match(pattern)?.[1] ?? "0", 10);
  return Number.isFinite(value) ? value : 0;
}

function parseShortstat(shortstat: string): DiffStats {
  return {
    filesCount: parseFirstIntegerMatch(shortstat, /(\d+)\s+files?\s+changed/u),
    insertions: parseFirstIntegerMatch(shortstat, /(\d+)\s+insertions?\(\+\)/u),
    deletions: parseFirstIntegerMatch(shortstat, /(\d+)\s+deletions?\(-\)/u),
  };
}

function tallyWorkspaceStats(stats: WorkspaceChangeStats): DiffStats {
  return {
    filesCount: stats.fileCount,
    insertions: stats.insertions,
    deletions: stats.deletions,
  };
}

type PrimaryAndFeatureWorktree = {
  primaryRepo: string;
  worktreePath: string;
};

async function createPrimaryAndFeatureWorktree(
  onTestFinished: TestContext["onTestFinished"],
): Promise<PrimaryAndFeatureWorktree> {
  const primaryRepo = await copyRepository(
    await makeTempDir(onTestFinished, "bb-workspace-repo-"),
  );
  const worktreeParent = await makeTempDir(
    onTestFinished,
    "bb-workspace-squash-worktree-parent-",
  );
  const worktreePath = path.join(worktreeParent, "feature");
  await runGit(["worktree", "add", "-b", "feature", worktreePath, "main"], {
    cwd: primaryRepo,
  });
  await fs.writeFile(path.join(worktreePath, "README.md"), "squash\n", "utf8");
  await runGit(["add", "README.md"], { cwd: worktreePath });
  await runGit(["commit", "-m", "Feature work"], { cwd: worktreePath });
  return { primaryRepo, worktreePath };
}

async function mergeFeatureIntoMainWithSquash(
  primaryRepo: string,
  message: string,
): Promise<void> {
  await runGit(["merge", "--squash", "feature"], { cwd: primaryRepo });
  await runGit(["commit", "--no-verify", "-m", message], {
    cwd: primaryRepo,
  });
}

describe.concurrent("WorkspaceReads", () => {
  it("reports clean, dirty, untracked-only, and mixed workspace states", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    const workspace = new WorkspaceReads(repoPath, tmpdir());

    expect(
      (await workspace.getStatus({ freshness: fresh() })).workingTree.state,
    ).toBe("clean");

    await fs.writeFile(path.join(repoPath, "README.md"), "dirty\n", "utf8");
    expect(
      (await workspace.getStatus({ freshness: fresh() })).workingTree.state,
    ).toBe("dirty_uncommitted");

    await runGit(["reset", "--hard", "HEAD"], { cwd: repoPath });
    await runGit(["clean", "-fd"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "notes.txt"), "note\n", "utf8");
    const untrackedStatus = await workspace.getStatus({ freshness: fresh() });
    expect(untrackedStatus.workingTree.state).toBe("untracked");
    expect(untrackedStatus.workingTree.files).toEqual([
      {
        path: "notes.txt",
        status: "??",
        insertions: null,
        deletions: null,
      },
    ]);
    expect(untrackedStatus.workingTree.insertions).toBe(0);
    expect(untrackedStatus.workingTree.deletions).toBe(0);
    expect(untrackedStatus.workingTree.lineStatsComplete).toBe(false);

    await fs.writeFile(
      path.join(repoPath, "README.md"),
      "dirty with note\n",
      "utf8",
    );
    const mixedStatus = await workspace.getStatus({ freshness: fresh() });
    expect(mixedStatus.workingTree.state).toBe("dirty_uncommitted");
    expect(mixedStatus.workingTree.files).toHaveLength(2);
  });

  it("reports deleted tracked files as dirty file changes", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    const workspace = new WorkspaceReads(repoPath, tmpdir());

    await fs.rm(path.join(repoPath, "README.md"));

    const status = await workspace.getStatus({ freshness: fresh() });
    expect(status.workingTree.state).toBe("dirty_uncommitted");
    expect(status.workingTree.files).toEqual([
      {
        path: "README.md",
        status: "D",
        insertions: 0,
        deletions: 1,
      },
    ]);
  });

  it("joins per-file numstat to a rename+modify under the new path", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    const workspace = new WorkspaceReads(repoPath, tmpdir());

    await runGit(["mv", "README.md", "NOTES.md"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "NOTES.md"),
      "hello\nworld\n",
      "utf8",
    );

    const status = await workspace.getStatus({ freshness: fresh() });
    expect(status.workingTree.files).toEqual([
      {
        path: "NOTES.md",
        status: "R",
        insertions: 1,
        deletions: 0,
      },
    ]);
    expect(status.workingTree.insertions).toBe(1);
    expect(status.workingTree.deletions).toBe(0);
  });

  it("reports null per-file stats for binary changes and excludes them from totals", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    const binaryPath = path.join(repoPath, "data.bin");
    await fs.writeFile(binaryPath, Buffer.from([0, 1, 2, 3, 0xff, 0xfe]));
    await runGit(["add", "data.bin"], { cwd: repoPath });
    await runGit(["commit", "-m", "Add binary"], { cwd: repoPath });

    await fs.writeFile(binaryPath, Buffer.from([10, 20, 30, 40, 50, 60]));
    await fs.writeFile(
      path.join(repoPath, "README.md"),
      "hello\nworld\n",
      "utf8",
    );

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const status = await workspace.getStatus({ freshness: fresh() });

    expect(status.workingTree.files).toEqual([
      {
        path: "README.md",
        status: "M",
        insertions: 1,
        deletions: 0,
      },
      {
        path: "data.bin",
        status: "M",
        insertions: null,
        deletions: null,
      },
    ]);
    expect(status.workingTree.insertions).toBe(1);
    expect(status.workingTree.deletions).toBe(0);
  });

  it("returns grouped status details only when merge-base data is requested", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "README.md"), "feature\n", "utf8");
    await runGit(["add", "README.md"], { cwd: repoPath });
    await runGit(["commit", "-m", "Feature commit"], { cwd: repoPath });

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const localOnlyStatus = await workspace.getStatus({ freshness: fresh() });
    expect(localOnlyStatus.mergeBase).toBeNull();
    expect(localOnlyStatus.workingTree.state).toBe("clean");

    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });
    expect(status.workingTree.state).toBe("committed_unmerged");
    expect(status.branch.currentBranch).toBe("feature");
    expect(status.branch.defaultBranch).toBe("main");
    expect(status.mergeBase).toMatchObject({
      mergeBaseBranch: "main",
      aheadCount: 1,
      behindCount: 0,
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: true,
    });
    expect(status.mergeBase?.commits[0]?.subject).toBe("Feature commit");
    expect(status.mergeBase?.files).toEqual([
      { path: "README.md", status: "M", insertions: 1, deletions: 1 },
    ]);
  });

  it("caps listed working-tree files, keeping tracked changes ahead of untracked files", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await fs.writeFile(path.join(repoPath, "a.txt"), "a\n", "utf8");
    await fs.writeFile(path.join(repoPath, "z.txt"), "z\n", "utf8");
    await runGit(["add", "a.txt", "z.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "Add tracked files"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "a.txt"), "a2\n", "utf8");
    await fs.writeFile(path.join(repoPath, "z.txt"), "z2\n", "utf8");
    await fs.mkdir(path.join(repoPath, "artifacts"));
    for (let index = 0; index < 5; index += 1) {
      await fs.writeFile(
        path.join(repoPath, "artifacts", `shot-${index}.txt`),
        `run ${index}\n`,
        "utf8",
      );
    }
    const workspace = new WorkspaceReads(repoPath, tmpdir());

    const status = await workspace.getStatus({
      freshness: fresh(),
      maxFiles: 3,
    });
    expect(status.workingTree.fileCount).toBe(7);
    expect(status.workingTree.state).toBe("dirty_uncommitted");
    expect(status.workingTree.insertions).toBe(2);
    expect(status.workingTree.deletions).toBe(2);
    expect(
      status.workingTree.files.map((file) => [file.status, file.path]),
    ).toEqual([
      ["M", "a.txt"],
      ["M", "z.txt"],
      ["??", "artifacts/shot-0.txt"],
    ]);

    const trackedOnly = await workspace.getStatus({
      freshness: fresh(),
      maxFiles: 1,
    });
    expect(trackedOnly.workingTree.fileCount).toBe(7);
    expect(
      trackedOnly.workingTree.files.map((file) => [file.status, file.path]),
    ).toEqual([["M", "a.txt"]]);

    const uncapped = await workspace.getStatus({ freshness: fresh() });
    expect(uncapped.workingTree.fileCount).toBe(7);
    expect(uncapped.workingTree.files).toHaveLength(7);
  });

  it("caps listed merge-base files while reporting the total", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    for (const name of ["one.txt", "two.txt", "three.txt"]) {
      await fs.writeFile(path.join(repoPath, name), `${name}\n`, "utf8");
    }
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(["commit", "-m", "Feature files"], { cwd: repoPath });

    const status = await new WorkspaceReads(repoPath, tmpdir()).getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
      maxFiles: 2,
    });

    expect(status.mergeBase?.fileCount).toBe(3);
    expect(status.mergeBase?.files).toHaveLength(2);
    expect(status.mergeBase?.insertions).toBe(3);
  });

  it("rejects a non-positive status file cap", async ({ onTestFinished }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await expect(
      new WorkspaceReads(repoPath, tmpdir()).getStatus({
        freshness: fresh(),
        maxFiles: 0,
      }),
    ).rejects.toBeInstanceOf(WorkspaceError);
  });

  it("reports untracked files plus committed unmerged changes as dirty_and_committed_unmerged", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "README.md"), "feature\n", "utf8");
    await runGit(["add", "README.md"], { cwd: repoPath });
    await runGit(["commit", "-m", "Feature commit"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "notes.txt"),
      "untracked pending\n",
      "utf8",
    );

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });

    expect(status.workingTree.state).toBe("dirty_and_committed_unmerged");
    expect(status.workingTree.files).toEqual([
      {
        path: "notes.txt",
        status: "??",
        insertions: null,
        deletions: null,
      },
    ]);
    expect(status.mergeBase).toMatchObject({
      mergeBaseBranch: "main",
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: true,
      aheadCount: 1,
      behindCount: 0,
    });
    expect(status.mergeBase?.files).toEqual([
      { path: "README.md", status: "M", insertions: 1, deletions: 1 },
    ]);
  });

  it("reports branches that are only behind their merge base as clean", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    await runGit(["checkout", "main"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "README.md"),
      "main update\n",
      "utf8",
    );
    await runGit(["add", "README.md"], { cwd: repoPath });
    await runGit(["commit", "-m", "Main update"], { cwd: repoPath });
    await runGit(["checkout", "feature"], { cwd: repoPath });

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });

    expect(status.workingTree.state).toBe("clean");
    expect(status.mergeBase).toMatchObject({
      mergeBaseBranch: "main",
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: false,
      aheadCount: 0,
      behindCount: 1,
    });
  });

  it.sequential("does not report a multi-commit squash-merged branch as ahead of its merge base", async ({
    onTestFinished,
  }) => {
    const { primaryRepo, worktreePath } =
      await createPrimaryAndFeatureWorktree(onTestFinished);
    await fs.writeFile(
      path.join(worktreePath, "feature.txt"),
      "feature extra\n",
      "utf8",
    );
    await runGit(["add", "feature.txt"], { cwd: worktreePath });
    await runGit(["commit", "-m", "Feature extra"], { cwd: worktreePath });

    const workspace = new WorkspaceReads(worktreePath, tmpdir());
    await mergeFeatureIntoMainWithSquash(
      primaryRepo,
      "feat: squash merge multi-commit feature into main",
    );

    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });

    expect(status.mergeBase).toMatchObject({
      mergeBaseBranch: "main",
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: false,
      aheadCount: 0,
    });
    expect(status.mergeBase?.commits).toEqual([]);
    expect(status.mergeBase?.files).toEqual([]);
    expect(status.mergeBase?.insertions).toBe(0);
    expect(status.mergeBase?.deletions).toBe(0);
  });

  it.sequential("recognizes squash-merged branch after main advances past the squash commit", async ({
    onTestFinished,
  }) => {
    const { primaryRepo, worktreePath } =
      await createPrimaryAndFeatureWorktree(onTestFinished);
    await fs.writeFile(
      path.join(worktreePath, "feature.txt"),
      "feature extra\n",
      "utf8",
    );
    await runGit(["add", "feature.txt"], { cwd: worktreePath });
    await runGit(["commit", "-m", "Feature extra"], { cwd: worktreePath });

    const workspace = new WorkspaceReads(worktreePath, tmpdir());
    await mergeFeatureIntoMainWithSquash(
      primaryRepo,
      "feat: squash merge feature into main",
    );

    await fs.writeFile(
      path.join(primaryRepo, "after-squash.txt"),
      "later\n",
      "utf8",
    );
    await runGit(["add", "after-squash.txt"], { cwd: primaryRepo });
    await runGit(["commit", "-m", "Main work after squash"], {
      cwd: primaryRepo,
    });

    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });

    expect(status.mergeBase).toMatchObject({
      mergeBaseBranch: "main",
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: false,
      aheadCount: 0,
    });
    expect(status.mergeBase?.behindCount).toBeGreaterThan(0);
  });

  it.sequential("treats a branch whose commits cancel out as merged", async ({
    onTestFinished,
  }) => {
    const { primaryRepo, worktreePath } =
      await createPrimaryAndFeatureWorktree(onTestFinished);
    await fs.writeFile(path.join(worktreePath, "README.md"), "hello\n", "utf8");
    await runGit(["add", "README.md"], { cwd: worktreePath });
    await runGit(["commit", "-m", "Revert feature"], { cwd: worktreePath });

    await fs.writeFile(
      path.join(primaryRepo, "main-work.txt"),
      "main\n",
      "utf8",
    );
    await runGit(["add", "main-work.txt"], { cwd: primaryRepo });
    await runGit(["commit", "-m", "Main advance"], { cwd: primaryRepo });

    const workspace = new WorkspaceReads(worktreePath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });

    expect(status.mergeBase).toMatchObject({
      mergeBaseBranch: "main",
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: false,
      aheadCount: 0,
    });
  });

  it("still reports genuine unmerged branch commits as ahead", async ({
    onTestFinished,
  }) => {
    const { worktreePath } =
      await createPrimaryAndFeatureWorktree(onTestFinished);
    await fs.writeFile(path.join(worktreePath, "extra.txt"), "extra\n", "utf8");
    await runGit(["add", "extra.txt"], { cwd: worktreePath });
    await runGit(["commit", "-m", "Feature extra"], { cwd: worktreePath });

    const workspace = new WorkspaceReads(worktreePath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });

    expect(status.mergeBase).toMatchObject({
      mergeBaseBranch: "main",
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: true,
      aheadCount: 2,
    });
  });

  it.sequential("does not report squash-merged branch commits as ahead of their merge base", async ({
    onTestFinished,
  }) => {
    const { primaryRepo, worktreePath } =
      await createPrimaryAndFeatureWorktree(onTestFinished);
    await fs.writeFile(
      path.join(primaryRepo, "notes.txt"),
      "main work\n",
      "utf8",
    );
    await runGit(["add", "notes.txt"], { cwd: primaryRepo });
    await runGit(["commit", "-m", "Main work"], { cwd: primaryRepo });

    const workspace = new WorkspaceReads(worktreePath, tmpdir());
    await mergeFeatureIntoMainWithSquash(
      primaryRepo,
      "feat: squash merge feature into main",
    );

    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });

    expect(status.workingTree.state).toBe("clean");
    expect(status.mergeBase).toMatchObject({
      mergeBaseBranch: "main",
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: false,
      aheadCount: 0,
      behindCount: 1,
    });
    expect(status.mergeBase?.commits).toEqual([]);
  });

  it("reports status for git repositories with no commits yet", async ({
    onTestFinished,
  }) => {
    const repoPath = await makeTempDir(
      onTestFinished,
      "bb-workspace-unborn-repo-",
    );
    await runGit(["init", "-b", "main"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "staged.txt"),
      "staged pending\n",
      "utf8",
    );
    await runGit(["add", "staged.txt"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "notes.txt"),
      "untracked pending\n",
      "utf8",
    );

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });

    expect(status.workingTree.state).toBe("dirty_uncommitted");
    expect(status.branch.currentBranch).toBe("main");
    expect(status.checkout).toEqual({ kind: "unborn", branchName: "main" });
    expect(status.workingTree.files).toEqual([
      {
        path: "staged.txt",
        status: "A",
        insertions: 1,
        deletions: 0,
      },
      {
        path: "notes.txt",
        status: "??",
        insertions: null,
        deletions: null,
      },
    ]);
    expect(status.workingTree.insertions).toBe(1);
    expect(status.workingTree.deletions).toBe(0);
    expect(status.workingTree.lineStatsComplete).toBe(false);
    expect(status.mergeBase).toEqual({
      mergeBaseBranch: "main",
      baseRef: null,
      aheadCount: 0,
      behindCount: 0,
      squashMergeCheckComplete: true,
      hasCommittedUnmergedChanges: false,
      commits: [],
      files: [],
      insertions: 0,
      deletions: 0,
      lineStatsComplete: true,
      fileCount: 0,
    });
  });

  it("resolves remote-only merge bases across status and diff reads", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-remote-base-"),
    );
    await runGit(["update-ref", "refs/remotes/origin/main", "main"], {
      cwd: repoPath,
    });
    await runGit(
      ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
      { cwd: repoPath },
    );
    await runGit(["branch", "-m", "main", "feature"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "committed.txt"), "branch change\n");
    await runGit(["add", "."], { cwd: repoPath });
    await runGit(["commit", "-m", "Feature change"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "README.md"), "pending change\n");
    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const target = { type: "all", mergeBaseBranch: "main" } as const;
    const [files, diff, remoteDiff, status] = await Promise.all([
      workspace.diffFiles({
        freshness: fresh(),
        target,
        maxFiles: 100,
        ignoreWhitespace: false,
      }),
      workspace.getDiff({
        ...UNLIMITED_DIFF,
        freshness: fresh(),
        target,
      }),
      workspace.getDiff({
        ...UNLIMITED_DIFF,
        freshness: fresh(),
        target: { ...target, mergeBaseBranch: "origin/main" },
      }),
      workspace.getStatus({
        freshness: fresh(),
        mergeBaseBranch: "main",
      }),
    ]);
    expect(files.files.map((file) => file.path).sort()).toEqual([
      "README.md",
      "committed.txt",
    ]);
    expect(diff).toEqual(remoteDiff);
    expect(status.mergeBase?.aheadCount).toBe(1);
    expect(status.mergeBase?.files.map((file) => file.path)).toEqual([
      "committed.txt",
    ]);
    await runGit(["branch", "main", "HEAD"], { cwd: repoPath });
    expect(
      (
        await workspace.getStatus({
          freshness: fresh(),
          mergeBaseBranch: "main",
        })
      ).mergeBase?.aheadCount,
    ).toBe(0);
  });

  it("reports unresolved merge bases instead of empty diffs", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-missing-base-"),
    );
    const workspace = new WorkspaceReads(repoPath, tmpdir());
    for (const type of ["all", "branch_committed"] as const) {
      const target = { type, mergeBaseBranch: "missing" };
      await expect(
        workspace.diffFiles({
          freshness: fresh(),
          target,
          maxFiles: 100,
          ignoreWhitespace: false,
        }),
      ).rejects.toThrow('Could not resolve merge base for "missing"');
      await expect(
        workspace.getDiff({ ...UNLIMITED_DIFF, freshness: fresh(), target }),
      ).rejects.toThrow('Could not resolve merge base for "missing"');
    }
  });

  it("returns diff content for each supported target", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "README.md"), "feature\n", "utf8");
    await runGit(["add", "README.md"], { cwd: repoPath });
    await runGit(["commit", "-m", "Feature commit"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "README.md"),
      "feature plus pending\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(repoPath, "notes.txt"),
      "untracked pending\n",
      "utf8",
    );

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });
    const commitSha = status.mergeBase?.commits[0]?.sha;
    expect(commitSha).toBeDefined();

    const uncommitted = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "uncommitted" },
    });
    expect(uncommitted.diff).toContain("feature plus pending");
    expect(uncommitted.diff).toContain("untracked pending");
    expect(uncommitted.files).toContain("README.md");
    expect(uncommitted.files).toContain("notes.txt");
    expect(uncommitted.shortstat).toContain("2 files changed");

    const branchCommitted = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "branch_committed", mergeBaseBranch: "main" },
    });
    expect(branchCommitted.diff).toContain("+feature");

    const all = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "all", mergeBaseBranch: "main" },
    });
    expect(all.diff).toContain("feature plus pending");
    expect(all.diff).toContain("untracked pending");
    expect(all.files).toContain("README.md");
    expect(all.files).toContain("notes.txt");
    expect(all.shortstat).toContain("2 files changed");

    const commitOnly = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "commit", sha: commitSha! },
    });
    expect(commitOnly.diff).toContain("+feature");
  });

  it("aligns committed-only status stats with all and committed diffs", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "README.md"), "feature\n", "utf8");
    await runGit(["add", "README.md"], { cwd: repoPath });
    await runGit(["commit", "-m", "Feature commit"], { cwd: repoPath });

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });
    expect(status.workingTree.files).toEqual([]);
    const mergeBase = status.mergeBase;
    expect(mergeBase).not.toBeNull();
    if (!mergeBase) {
      throw new Error("Expected merge-base status");
    }

    const allChanges = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "all", mergeBaseBranch: "main" },
    });
    const committedChanges = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "branch_committed", mergeBaseBranch: "main" },
    });
    const bannerStats = tallyWorkspaceStats(mergeBase);

    expect(bannerStats).toEqual(parseShortstat(allChanges.shortstat));
    expect(bannerStats).toEqual(parseShortstat(committedChanges.shortstat));
  });

  it("marks status line stats incomplete when untracked content is omitted", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await fs.writeFile(
      path.join(repoPath, "README.md"),
      "hello\npending\n",
      "utf8",
    );
    await fs.writeFile(path.join(repoPath, "notes.txt"), "note\n", "utf8");

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });
    expect(status.mergeBase?.files ?? []).toEqual([]);

    const allChanges = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "all", mergeBaseBranch: "main" },
    });
    const uncommittedChanges = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "uncommitted" },
    });
    const bannerStats = tallyWorkspaceStats(status.workingTree);

    expect(status.workingTree.lineStatsComplete).toBe(false);
    expect(bannerStats).toEqual({
      filesCount: 2,
      insertions: 1,
      deletions: 0,
    });
    expect(parseShortstat(allChanges.shortstat)).toEqual({
      filesCount: 2,
      insertions: 2,
      deletions: 0,
    });
    expect(parseShortstat(uncommittedChanges.shortstat)).toEqual(
      parseShortstat(allChanges.shortstat),
    );
  });

  it("enriches small untracked status snapshots within file and byte budgets", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await fs.writeFile(
      path.join(repoPath, "README.md"),
      "hello\npending\n",
      "utf8",
    );
    await fs.writeFile(path.join(repoPath, "notes.txt"), "one\ntwo\n", "utf8");
    const statusBefore = await runGit(["status", "--porcelain=v1"], {
      cwd: repoPath,
    });

    const status = await new WorkspaceReads(repoPath, tmpdir()).getStatus({
      freshness: fresh(),
      maxUntrackedLineStatFiles: 10,
      maxUntrackedLineStatBytes: 1024,
    });

    expect(status.workingTree.files).toEqual([
      {
        path: "README.md",
        status: "M",
        insertions: 1,
        deletions: 0,
      },
      {
        path: "notes.txt",
        status: "??",
        insertions: 2,
        deletions: 0,
      },
    ]);
    expect(status.workingTree).toMatchObject({
      insertions: 3,
      deletions: 0,
      lineStatsComplete: true,
    });
    const statusAfter = await runGit(["status", "--porcelain=v1"], {
      cwd: repoPath,
    });
    expect(statusAfter.stdout).toBe(statusBefore.stdout);
  });

  it("keeps tracked deletion stats separate from an untracked replacement at the same path", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await fs.writeFile(
      path.join(repoPath, "replacement.txt"),
      "one\ntwo\nthree\n",
      "utf8",
    );
    await runGit(["add", "replacement.txt"], { cwd: repoPath });
    await runGit(["commit", "-m", "Add replacement target"], {
      cwd: repoPath,
    });
    await runGit(["rm", "--cached", "replacement.txt"], { cwd: repoPath });

    const status = await new WorkspaceReads(repoPath, tmpdir()).getStatus({
      freshness: fresh(),
      maxUntrackedLineStatFiles: 10,
      maxUntrackedLineStatBytes: 1024,
    });

    expect(status.workingTree.files).toEqual([
      {
        path: "replacement.txt",
        status: "D",
        insertions: 0,
        deletions: 3,
      },
      {
        path: "replacement.txt",
        status: "??",
        insertions: 3,
        deletions: 0,
      },
    ]);
    expect(status.workingTree).toMatchObject({
      insertions: 3,
      deletions: 3,
      lineStatsComplete: true,
    });
  });

  it("enriches eligible untracked files when another entry is a nested repository", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await fs.writeFile(path.join(repoPath, "notes.txt"), "one\ntwo\n", "utf8");
    const nestedRepoPath = path.join(repoPath, "vendor");
    await fs.mkdir(nestedRepoPath);
    await runGit(["init", "-b", "main"], { cwd: nestedRepoPath });
    await fs.writeFile(path.join(nestedRepoPath, "inside.txt"), "inside\n");

    const status = await new WorkspaceReads(repoPath, tmpdir()).getStatus({
      freshness: fresh(),
      maxUntrackedLineStatFiles: 10,
      maxUntrackedLineStatBytes: 1024,
    });

    expect(status.workingTree.files).toEqual([
      {
        path: "notes.txt",
        status: "??",
        insertions: 2,
        deletions: 0,
      },
      {
        path: "vendor/",
        status: "??",
        insertions: null,
        deletions: null,
      },
    ]);
    expect(status.workingTree).toMatchObject({
      insertions: 2,
      deletions: 0,
      lineStatsComplete: false,
    });
  });

  it("leaves untracked status stats unknown when either enrichment budget is exceeded", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await fs.writeFile(path.join(repoPath, "one.txt"), "one\n", "utf8");
    await fs.writeFile(path.join(repoPath, "two.txt"), "two\n", "utf8");
    const workspace = new WorkspaceReads(repoPath, tmpdir());

    const overFileBudget = await workspace.getStatus({
      freshness: fresh(),
      maxUntrackedLineStatFiles: 1,
      maxUntrackedLineStatBytes: 1024,
    });
    const overByteBudget = await workspace.getStatus({
      freshness: fresh(),
      maxUntrackedLineStatFiles: 10,
      maxUntrackedLineStatBytes: 1,
    });

    for (const status of [overFileBudget, overByteBudget]) {
      expect(status.workingTree.lineStatsComplete).toBe(false);
      expect(
        status.workingTree.files
          .filter((file) => file.status === "??")
          .every((file) => file.insertions === null && file.deletions === null),
      ).toBe(true);
    }
  });

  it("keeps tracked status totals explicitly incomplete in a mixed workspace", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "README.md"), "feature\n", "utf8");
    await runGit(["add", "README.md"], { cwd: repoPath });
    await runGit(["commit", "-m", "Feature commit"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "README.md"),
      "feature\npending\n",
      "utf8",
    );
    await fs.writeFile(path.join(repoPath, "notes.txt"), "note\n", "utf8");

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const status = await workspace.getStatus({
      freshness: fresh(),
      mergeBaseBranch: "main",
    });
    expect(status.workingTree.state).toBe("dirty_and_committed_unmerged");

    const allChanges = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "all", mergeBaseBranch: "main" },
    });
    const uncommittedChanges = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "uncommitted" },
    });
    const bannerStats = tallyWorkspaceStats(status.workingTree);

    expect(status.workingTree.lineStatsComplete).toBe(false);
    expect(bannerStats).not.toEqual(
      parseShortstat(uncommittedChanges.shortstat),
    );
    expect(bannerStats).not.toEqual(parseShortstat(allChanges.shortstat));
  });

  it("truncates large git diff output before the process buffer fails", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    await fs.writeFile(
      path.join(repoPath, "README.md"),
      Array.from({ length: 200 }, (_, index) => `large diff line ${index}`)
        .join("\n")
        .concat("\n"),
      "utf8",
    );

    const workspace = new WorkspaceReads(repoPath, tmpdir());
    const diff = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "all", mergeBaseBranch: "main" },
      maxDiffBytes: 128,
    });

    expect(diff.truncated).toBe(true);
    expect(Buffer.byteLength(diff.diff, "utf8")).toBeLessThanOrEqual(128);
    expect(diff.diff).toContain("diff --git");
    expect(diff.files).toContain("README.md");
    expect(diff.shortstat).toContain("1 file changed");
  });

  it("includes untracked files in one combined diff", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    const workspace = new WorkspaceReads(repoPath, tmpdir());

    await Promise.all(
      Array.from({ length: 12 }, async (_, index) => {
        await fs.writeFile(
          path.join(repoPath, `note-${index}.txt`),
          `untracked ${index}\n`,
          "utf8",
        );
      }),
    );

    const diff = await workspace.getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "uncommitted" },
    });

    expect(diff.diff).toContain("untracked 11");
    expect(diff.files).toContain("note-11.txt");
    expect(diff.shortstat).toContain("12 files changed");
  });

  it("bounds full-diff untracked content and reports truncation", async ({
    onTestFinished,
  }) => {
    const repoPath = await copyRepository(
      await makeTempDir(onTestFinished, "bb-workspace-repo-"),
    );
    await fs.writeFile(path.join(repoPath, "a.txt"), "first\n", "utf8");
    await fs.writeFile(path.join(repoPath, "b.txt"), "second\n", "utf8");

    const diff = await new WorkspaceReads(repoPath, tmpdir()).getDiff({
      ...UNLIMITED_DIFF,
      freshness: fresh(),
      target: { type: "uncommitted" },
      maxUntrackedFiles: 1,
    });

    expect(diff.truncated).toBe(true);
    expect(diff.files).toContain("a.txt");
    expect(diff.files).not.toContain("b.txt");
    expect(diff.diff).toContain("first");
    expect(diff.diff).not.toContain("second");
  });
});
