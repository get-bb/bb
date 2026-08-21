import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/workspace.js";
import { getCheckoutRef, readDefaultBranch, runGit } from "../src/git.js";
import { createWorktree, removeWorktree } from "../src/provisioning.js";

const execFileAsync = promisify(execFile);

const jjAvailable = await execFileAsync("jj", ["--version"]).then(
  () => true,
  () => false,
);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runJj(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("jj", args, { cwd });
  return result.stdout;
}

async function initColocatedJjRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-jj-provisioning-repo-");
  await runJj(["git", "init", "--colocate"], repoPath);
  await runJj(["config", "set", "--repo", "user.name", "BB Tests"], repoPath);
  await runJj(
    ["config", "set", "--repo", "user.email", "bb@example.com"],
    repoPath,
  );
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runJj(["commit", "-m", "Initial commit"], repoPath);
  await runJj(["bookmark", "create", "main", "-r", "@-"], repoPath);
  return repoPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe.skipIf(!jjAvailable)("provisioning from colocated jj sources", () => {
  it("creates, uses, and removes a managed worktree from a jj source", async () => {
    const sourceRepo = await initColocatedJjRepo();
    const parentDir = await makeTempDir("bb-jj-worktree-parent-");
    const worktreePath = path.join(parentDir, "feature");

    await createWorktree({
      sourcePath: sourceRepo,
      targetPath: worktreePath,
      branchName: "bb/test-thread",
      baseBranch: "main",
      timeoutMs: 900000,
    });

    const checkout = await getCheckoutRef(worktreePath);
    expect(checkout).toMatchObject({
      kind: "branch",
      branchName: "bb/test-thread",
    });
    const gitDir = await runGit(["rev-parse", "--git-dir"], {
      cwd: worktreePath,
    });
    expect(gitDir.stdout).toContain("/worktrees/");

    // A commit in the worktree imports into the source's jj as the same-named
    // bookmark, with no conflicts.
    await runGit(["config", "user.name", "BB Tests"], { cwd: worktreePath });
    await runGit(["config", "user.email", "bb@example.com"], {
      cwd: worktreePath,
    });
    await fs.writeFile(path.join(worktreePath, "work.txt"), "work\n", "utf8");
    const workspace = new Workspace(worktreePath);
    await workspace.commit({ message: "worktree commit", noVerify: true });
    const bookmarks = await runJj(["bookmark", "list", "--all"], sourceRepo);
    expect(bookmarks).toContain("bb/test-thread");

    await removeWorktree({ path: worktreePath });
    await expect(fs.stat(worktreePath)).rejects.toThrow();
    // The source workspace stays intact.
    const sourceStatus = await runJj(["status"], sourceRepo);
    expect(sourceStatus).toContain("The working copy has no changes.");
  });

  it("resolves the default branch in a colocated jj clone", async () => {
    const upstream = await initColocatedJjRepo();
    const remoteParent = await makeTempDir("bb-jj-remote-");
    const remotePath = path.join(remoteParent, "remote.git");
    await runGit(["clone", "--bare", upstream, remotePath], {
      cwd: remoteParent,
    });

    const cloneParent = await makeTempDir("bb-jj-clone-parent-");
    const clonePath = path.join(cloneParent, "repo");
    await runJj(
      ["git", "clone", "--colocate", remotePath, clonePath],
      cloneParent,
    );

    const defaultBranch = await readDefaultBranch(clonePath);
    expect(defaultBranch).toBe("main");
  });

  it("changes the shared refs fingerprint when a bookmark moves", async () => {
    const repoPath = await initColocatedJjRepo();
    const workspace = new Workspace(repoPath);
    const before = await workspace.getSharedGitRefsFingerprint();

    await fs.writeFile(path.join(repoPath, "more.txt"), "more\n", "utf8");
    await runJj(["commit", "-m", "Second commit"], repoPath);
    await runJj(["bookmark", "move", "main", "--to", "@-"], repoPath);

    const after = await workspace.getSharedGitRefsFingerprint();
    expect(after).not.toBe(before);
  });
});
