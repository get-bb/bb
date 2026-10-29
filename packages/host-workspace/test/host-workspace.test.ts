import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDeferredPromise, initRepo, makeTempDir } from "@bb/test-helpers";
import {
  ProcessLocalQueuedLockTimeoutError,
  withProcessLocalQueuedLocks,
} from "bb-environment-provider-host/process-local-lock";
import { Workspace } from "../src/host-workspace.js";
import { runGit } from "bb-environment-provider-host/workspace-git";
import { withCheckoutMutationLock } from "../src/checkout-mutation-lock.js";

function waitForLockContention(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

describe("Workspace", () => {
  it("changes the local state fingerprint when local checkout state changes", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace({
      path: repoPath,
      isGitRepo: false,
      isWorktree: false,
    });

    const initialFingerprint = await workspace.getLocalStateSnapshot();
    expect(initialFingerprint.branchName).toBe("main");

    await fs.writeFile(path.join(repoPath, "README.md"), "dirty\n", "utf8");
    const dirtyFingerprint = await workspace.getLocalStateSnapshot();
    expect(dirtyFingerprint.fingerprint).not.toBe(
      initialFingerprint.fingerprint,
    );

    await runGit(["checkout", "-b", "feature"], { cwd: repoPath });
    const branchFingerprint = await workspace.getLocalStateSnapshot();
    expect(branchFingerprint.fingerprint).not.toBe(
      dirtyFingerprint.fingerprint,
    );
    expect(branchFingerprint.branchName).toBe("feature");
    await runGit(["checkout", "--detach"], { cwd: repoPath });
    const detached = await workspace.getLocalStateSnapshot();
    expect(detached.branchName).toBeNull();
    expect(detached.fingerprint).not.toBe(branchFingerprint.fingerprint);
  });

  it("observes the initial branch before the first commit", async () => {
    const repoPath = await makeTempDir("bb-workspace-unborn-");
    await runGit(["init", "-b", "main"], { cwd: repoPath });
    const workspace = new Workspace({
      path: repoPath,
      isGitRepo: false,
      isWorktree: false,
    });
    expect((await workspace.getLocalStateSnapshot()).branchName).toBe("main");
    expect(
      (await workspace.getSharedGitRefsSnapshot()).defaultBranch,
    ).toBeNull();
  });

  it("fingerprints an untracked path without reading its contents", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace({
      path: repoPath,
      isGitRepo: false,
      isWorktree: false,
    });
    const initialFingerprint = await workspace.getLocalStateSnapshot();

    await fs.writeFile(path.join(repoPath, "notes.txt"), "one\n", "utf8");
    const untrackedFingerprint = await workspace.getLocalStateSnapshot();
    expect(untrackedFingerprint.fingerprint).not.toBe(
      initialFingerprint.fingerprint,
    );

    await fs.writeFile(path.join(repoPath, "notes.txt"), "one\ntwo\n", "utf8");
    expect(await workspace.getLocalStateSnapshot()).toEqual(
      untrackedFingerprint,
    );
  });

  it.for(["files", "reftable"])(
    "includes the default branch in %s shared refs without depending on file edits",
    async (format, context) => {
      const repoPath = await makeTempDir("bb-workspace-repo-");
      await initRepo(repoPath);
      if (format === "reftable") {
        const migration = await runGit(
          ["refs", "migrate", "--ref-format=reftable"],
          { cwd: repoPath, allowFailure: true },
        );
        if (migration.exitCode !== 0) context.skip();
      }
      const workspace = new Workspace({
        path: repoPath,
        isGitRepo: false,
        isWorktree: false,
      });
      const initialSnapshot = await workspace.getSharedGitRefsSnapshot();
      expect(initialSnapshot.defaultBranch).toBe("main");

      await fs.writeFile(path.join(repoPath, "README.md"), "dirty\n", "utf8");
      expect(await workspace.getSharedGitRefsSnapshot()).toEqual(
        initialSnapshot,
      );

      await runGit(["branch", "feature"], { cwd: repoPath });
      const branchSnapshot = await workspace.getSharedGitRefsSnapshot();
      expect(branchSnapshot.fingerprint).not.toBe(initialSnapshot.fingerprint);
      expect(branchSnapshot.defaultBranch).toBe("main");

      await runGit(["update-ref", "refs/remotes/origin/main", "HEAD"], {
        cwd: repoPath,
      });
      await runGit(["update-ref", "refs/remotes/origin/trunk", "HEAD"], {
        cwd: repoPath,
      });
      await runGit(
        [
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
          "refs/remotes/origin/main",
        ],
        { cwd: repoPath },
      );
      const originMainSnapshot = await workspace.getSharedGitRefsSnapshot();
      expect(originMainSnapshot.defaultBranch).toBe("main");
      await runGit(
        [
          "symbolic-ref",
          "refs/remotes/origin/HEAD",
          "refs/remotes/origin/trunk",
        ],
        { cwd: repoPath },
      );
      const remoteSnapshot = await workspace.getSharedGitRefsSnapshot();
      expect(remoteSnapshot.fingerprint).not.toBe(
        originMainSnapshot.fingerprint,
      );
      expect(remoteSnapshot.defaultBranch).toBe("trunk");
      await runGit(["update-ref", "-d", "refs/remotes/origin/trunk"], {
        cwd: repoPath,
      });
      expect((await workspace.getSharedGitRefsSnapshot()).defaultBranch).toBe(
        "trunk",
      );
      await runGit(
        [
          "symbolic-ref",
          "refs/remotes/origin/trunk",
          "refs/remotes/origin/missing",
        ],
        { cwd: repoPath },
      );
      expect((await workspace.getSharedGitRefsSnapshot()).defaultBranch).toBe(
        "missing",
      );
      await runGit(["symbolic-ref", "--delete", "refs/remotes/origin/trunk"], {
        cwd: repoPath,
      });

      await runGit(["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"], {
        cwd: repoPath,
      });
      await runGit(["branch", "-m", "main", "master"], { cwd: repoPath });
      expect((await workspace.getSharedGitRefsSnapshot()).defaultBranch).toBe(
        "master",
      );
      await runGit(["checkout", "feature"], { cwd: repoPath });
      await runGit(["branch", "-D", "master"], { cwd: repoPath });
      expect((await workspace.getSharedGitRefsSnapshot()).defaultBranch).toBe(
        "feature",
      );
    },
  );

  it("commits staged work", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace({
      path: repoPath,
      isGitRepo: false,
      isWorktree: false,
    });

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
    const workspace = new Workspace({
      path: repoPath,
      isGitRepo: false,
      isWorktree: false,
    });

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

  it("returns null when HEAD is unavailable in an empty repository", async () => {
    const repoPath = await makeTempDir("bb-workspace-empty-repo-");
    await runGit(["init", "-b", "main"], { cwd: repoPath });
    await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
    await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });

    const workspace = new Workspace({
      path: repoPath,
      isGitRepo: false,
      isWorktree: false,
    });

    expect(await workspace.getHeadSha()).toBeNull();
  });
  it("serializes same-checkout mutations", async () => {
    const repoPath = await initRepo(await makeTempDir("bb-workspace-repo-"));
    const workspace = new Workspace({
      path: repoPath,
      isGitRepo: false,
      isWorktree: false,
    });
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
      (await runGit(["status", "--porcelain"], { cwd: repoPath })).stdout,
    ).toBe("");
  });

  it("rejects git mutations for non-git directories", async () => {
    const folder = await makeTempDir("bb-workspace-nongit-");
    const workspace = new Workspace({
      path: folder,
      isGitRepo: false,
      isWorktree: false,
    });

    expect(await workspace.getCurrentBranch()).toBeNull();
    await expect(
      workspace.commit({ message: "nope", noVerify: false }),
    ).rejects.toThrow(/not a git repository/u);
  });
});
