import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDeferredPromise, initRepo, makeTempDir } from "@bb/test-helpers";
import {
  ProcessLocalQueuedLockTimeoutError,
  withProcessLocalQueuedLocks,
} from "bb-environment-provider-host/process-local-lock";
import { Workspace } from "../src/workspace.js";
import { runGit } from "bb-git-host/git";
import { withCheckoutMutationLock } from "../src/checkout-mutation-lock.js";

function waitForLockContention(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

describe("Workspace", () => {
  it("changes the local state fingerprint when local checkout state changes", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace(repoPath);

    const initialFingerprint = await workspace.getLocalStateFingerprint();

    await fs.writeFile(path.join(repoPath, "README.md"), "dirty\n", "utf8");
    const dirtyFingerprint = await workspace.getLocalStateFingerprint();
    expect(dirtyFingerprint).not.toBe(initialFingerprint);

    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    const branchFingerprint = await workspace.getLocalStateFingerprint();
    expect(branchFingerprint).not.toBe(dirtyFingerprint);
  });

  it("fingerprints an untracked path without reading its contents", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace(repoPath);
    const initialFingerprint = await workspace.getLocalStateFingerprint();

    await fs.writeFile(path.join(repoPath, "notes.txt"), "one\n", "utf8");
    const untrackedFingerprint = await workspace.getLocalStateFingerprint();
    expect(untrackedFingerprint).not.toBe(initialFingerprint);

    await fs.writeFile(path.join(repoPath, "notes.txt"), "one\ntwo\n", "utf8");
    expect(await workspace.getLocalStateFingerprint()).toBe(
      untrackedFingerprint,
    );
  });

  it("changes the shared git refs fingerprint only when refs change", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace(repoPath);

    const initialFingerprint = await workspace.getSharedGitRefsFingerprint();

    await fs.writeFile(path.join(repoPath, "README.md"), "dirty\n", "utf8");
    const dirtyFingerprint = await workspace.getSharedGitRefsFingerprint();
    expect(dirtyFingerprint).toBe(initialFingerprint);

    await runGit(["branch", "feature"], { cwd: repoPath });
    const branchFingerprint = await workspace.getSharedGitRefsFingerprint();
    expect(branchFingerprint).not.toBe(initialFingerprint);
  });

  it("commits staged work", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace(repoPath);

    await fs.writeFile(path.join(repoPath, "README.md"), "commit me\n", "utf8");
    const commit = await workspace.commit({
      message: "Commit from workspace",
      noVerify: false,
    });
    const head = (
      await runGit(["rev-parse", "HEAD"], { cwd: repoPath })
    ).stdout.trim();
    expect(commit.commitSha).toBe(head);
  });

  it("throws a typed no_changes error when there is nothing to commit", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace(repoPath);

    await expect(
      workspace.commit({ message: "nothing to commit", noVerify: false }),
    ).rejects.toMatchObject({
      name: "WorkspaceError",
      code: "no_changes",
    });

    await fs.writeFile(path.join(repoPath, "new.txt"), "real work\n", "utf8");
    const commit = await workspace.commit({
      message: "real commit",
      noVerify: false,
    });
    expect(typeof commit.commitSha).toBe("string");
  });

  it("serializes same-checkout mutations", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace(repoPath);
    await fs.writeFile(path.join(repoPath, "README.md"), "pending\n", "utf8");

    const lockEntered = createDeferredPromise<void>();
    const releaseLock = createDeferredPromise<void>();
    const heldLock = withCheckoutMutationLock(repoPath, async () => {
      lockEntered.resolve();
      await releaseLock.promise;
    });
    await lockEntered.promise;

    let commitCompleted = false;
    const commit = workspace
      .commit({ message: "pending", noVerify: false })
      .then(() => {
        commitCompleted = true;
      });
    await waitForLockContention();

    expect(commitCompleted).toBe(false);

    releaseLock.resolve();
    await Promise.all([heldLock, commit]);

    expect(commitCompleted).toBe(true);
    expect(
      (await runGit(["status", "--porcelain"], { cwd: workspace.path })).stdout,
    ).toBe("");
  });

  it("does not serialize different linked worktree checkout mutations", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const worktreeParent = await makeTempDir("bb-workspace-lock-worktrees-");
    const worktreePath = path.join(worktreeParent, "feature");
    await runGit(["worktree", "add", "-b", "feature", worktreePath, "main"], {
      cwd: repoPath,
    });

    const primaryLockEntered = createDeferredPromise<void>();
    const releasePrimaryLock = createDeferredPromise<void>();
    const primaryLock = withCheckoutMutationLock(repoPath, async () => {
      primaryLockEntered.resolve();
      await releasePrimaryLock.promise;
    });
    await primaryLockEntered.promise;

    let worktreeLockEntered = false;
    await withCheckoutMutationLock(worktreePath, async () => {
      worktreeLockEntered = true;
    });

    releasePrimaryLock.resolve();
    await primaryLock;

    expect(worktreeLockEntered).toBe(true);
  });

  it("skips process-local lock waiters that time out before entry", async () => {
    const entered = createDeferredPromise<void>();
    const release = createDeferredPromise<void>();
    let timedOutWorkRan = false;
    const first = withProcessLocalQueuedLocks({
      locks: [{ key: "timed-out-skip-lock", timeoutMs: 0 }],
      work: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    await entered.promise;

    await expect(
      withProcessLocalQueuedLocks({
        locks: [{ key: "timed-out-skip-lock", timeoutMs: 10 }],
        work: async () => {
          timedOutWorkRan = true;
        },
      }),
    ).rejects.toBeInstanceOf(ProcessLocalQueuedLockTimeoutError);

    release.resolve();
    await first;
    await expect(
      withProcessLocalQueuedLocks({
        locks: [{ key: "timed-out-skip-lock", timeoutMs: 1000 }],
        work: async () => "after-timeout",
      }),
    ).resolves.toBe("after-timeout");
    expect(timedOutWorkRan).toBe(false);
  });

  it("rejects git mutations for non-git directories", async () => {
    const folder = await makeTempDir("bb-workspace-nongit-");
    const workspace = new Workspace(folder);

    expect(await workspace.currentBranch).toBeUndefined();
    await expect(
      workspace.commit({ message: "nope", noVerify: false }),
    ).rejects.toThrow(/not a git repository/u);
  });

  it("returns null when HEAD is unavailable in an empty repository", async () => {
    const repoPath = await makeTempDir("bb-workspace-empty-repo-");
    await runGit(["init", "-b", "main"], { cwd: repoPath });
    await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
    await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });

    const workspace = new Workspace(repoPath);

    expect(await workspace.getHeadSha()).toBeNull();
  });
});

describe("getPullRequest", () => {
  it("reports a vanished workspace path as unavailable, not absent", async () => {
    const missingPath = path.join(
      os.tmpdir(),
      `bb-missing-workspace-${process.pid}-${Date.now()}`,
    );
    const workspace = new Workspace(missingPath);
    await expect(workspace.getPullRequest()).resolves.toEqual({
      outcome: "unavailable",
      message: `Workspace path no longer exists: ${missingPath}`,
    });
  });
});
