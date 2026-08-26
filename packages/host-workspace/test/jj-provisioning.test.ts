import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { runJj } from "../src/jj.js";
import { createWorktree, removeWorktree } from "../src/provisioning.js";
import { provisionWorkspace } from "../src/provision.js";
import { resolveAdditionalWorkspaceWriteRoots } from "../src/workspace-write-roots.js";

const execFileAsync = promisify(execFile);

const jjAvailable = await execFileAsync("jj", ["--version"]).then(
  () => true,
  () => false,
);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return await fs.realpath(dir);
}

async function initColocatedSource(): Promise<string> {
  const sourcePath = await makeTempDir("bb-jj-provision-source-");
  await runJj(["git", "init", "--colocate"], { cwd: sourcePath });
  await runJj(["config", "set", "--repo", "user.name", "BB Tests"], {
    cwd: sourcePath,
  });
  await runJj(["config", "set", "--repo", "user.email", "bb@example.com"], {
    cwd: sourcePath,
  });
  await fs.writeFile(path.join(sourcePath, "README.md"), "hello\n", "utf8");
  await runJj(["commit", "-m", "Initial commit"], { cwd: sourcePath });
  await runJj(["bookmark", "create", "main", "-r", "@-"], { cwd: sourcePath });
  return sourcePath;
}

async function provision(sourcePath: string, branchName: string) {
  const parent = await makeTempDir("bb-jj-provision-target-");
  const targetPath = path.join(parent, "repo");
  await createWorktree({
    sourcePath,
    targetPath,
    branchName,
    baseBranch: "main",
    timeoutMs: 60_000,
    pruneEmptyParent: true,
  });
  return targetPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!jjAvailable)("provisioning against a colocated jj source", () => {
  it("creates a jj workspace that git can also read", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    const workspaces = await runJj(
      ["workspace", "list", "-T", 'name ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(workspaces.stdout.split("\n")).toContain("bb/thread-1");
    // The shadow git registration is what keeps every git-based read working.
    const gitDir = await runGit(["rev-parse", "--git-dir"], {
      cwd: targetPath,
    });
    expect(gitDir.stdout).toContain("/worktrees/");
    expect(
      (await runGit(["status", "--porcelain"], { cwd: targetPath })).stdout.trim(),
    ).toBe("");
  });

  it("provisions a workspace that commits through jj and reports its bookmark", async () => {
    const sourcePath = await initColocatedSource();
    const parent = await makeTempDir("bb-jj-provision-target-");
    const targetPath = path.join(parent, "repo");

    const hostWorkspace = await provisionWorkspace({
      workspaceProvisionType: "managed-worktree",
      sourcePath,
      targetPath,
      branchName: "bb/thread-1",
      baseBranch: "main",
      timeoutMs: 60_000,
    });
    expect(hostWorkspace.isWorktree).toBe(true);
    // The server names the checkout from this: a jj source gets a workspace.
    expect(hostWorkspace.vcs).toBe("jj");

    await fs.writeFile(path.join(targetPath, "work.txt"), "work\n", "utf8");
    const status = await hostWorkspace.getStatus();
    expect(status.workingTree.files.map((file) => file.path)).toEqual([
      "work.txt",
    ]);

    const commit = await hostWorkspace.commit({
      message: "thread work",
      noVerify: true,
    });
    // Committed through jj: the bookmark moved and no anonymous head was left
    // behind in the source repository.
    const bookmark = await runJj(
      ["log", "--no-graph", "-r", "bb/thread-1", "-T", "commit_id"],
      { cwd: sourcePath },
    );
    expect(bookmark.stdout.trim()).toBe(commit.commitSha);
  });

  it("grants agents write access to the repository state outside the workspace", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    const roots = await resolveAdditionalWorkspaceWriteRoots(targetPath);
    expect(roots).toContain(path.join(sourcePath, ".jj", "repo"));
    expect(roots).toContain(path.join(sourcePath, ".git", "objects"));
  });

  it("forgets the jj workspace when the checkout is removed", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    await removeWorktree({
      path: targetPath,
      force: true,
      pruneEmptyParent: true,
      timeoutMs: 60_000,
    });

    const workspaces = await runJj(
      ["workspace", "list", "-T", 'name ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(workspaces.stdout.split("\n")).not.toContain("bb/thread-1");
    const worktrees = await runGit(["worktree", "list"], { cwd: sourcePath });
    expect(worktrees.stdout).not.toContain(targetPath);
    await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reuses an existing workspace and rejects a mismatched one", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    // Re-provisioning the same environment must be idempotent.
    await expect(
      createWorktree({
        sourcePath,
        targetPath,
        branchName: "bb/thread-1",
        baseBranch: "main",
        timeoutMs: 60_000,
        pruneEmptyParent: true,
      }),
    ).resolves.toMatchObject({ path: targetPath });

    await expect(
      createWorktree({
        sourcePath,
        targetPath,
        branchName: "bb/other-thread",
        baseBranch: "main",
        timeoutMs: 60_000,
        pruneEmptyParent: true,
      }),
    ).rejects.toMatchObject({ code: "path_exists" });
  });

  it("bases a workspace on a remote-tracking branch", async () => {
    // bb resolves default bases in git's spelling ("origin/main"). jj has no
    // such revision — the same commit is the remote bookmark "main@origin".
    const upstream = await initColocatedSource();
    const remoteParent = await makeTempDir("bb-jj-remote-");
    const remotePath = path.join(remoteParent, "remote.git");
    await runGit(["clone", "--bare", upstream, remotePath], {
      cwd: remoteParent,
    });
    const cloneParent = await makeTempDir("bb-jj-clone-");
    const clonePath = path.join(cloneParent, "repo");
    await runJj(["git", "clone", "--colocate", remotePath, clonePath], {
      cwd: cloneParent,
    });

    const parent = await makeTempDir("bb-jj-provision-target-");
    const targetPath = path.join(parent, "repo");
    await createWorktree({
      sourcePath: clonePath,
      targetPath,
      branchName: "bb/thread-1",
      baseBranch: "origin/main",
      timeoutMs: 60_000,
      pruneEmptyParent: true,
    });

    const head = await runGit(["rev-parse", "HEAD"], { cwd: targetPath });
    const remoteMain = await runGit(["rev-parse", "refs/remotes/origin/main"], {
      cwd: clonePath,
    });
    expect(head.stdout.trim()).toBe(remoteMain.stdout.trim());
  });

  it("leaves nothing registered when provisioning fails", async () => {
    const sourcePath = await initColocatedSource();
    const parent = await makeTempDir("bb-jj-provision-target-");
    const targetPath = path.join(parent, "repo");

    // jj creates the workspace before it resolves the revision, so a bad base
    // fails with a workspace already registered. Rollback has to undo that, or
    // the next attempt trips over the leftover.
    await expect(
      createWorktree({
        sourcePath,
        targetPath,
        branchName: "bb/thread-1",
        baseBranch: "no-such-branch",
        timeoutMs: 60_000,
        pruneEmptyParent: true,
      }),
    ).rejects.toThrow();

    const workspaces = await runJj(
      ["workspace", "list", "-T", 'name ++ "\\n"'],
      { cwd: sourcePath },
    );
    expect(workspaces.stdout.split("\n")).not.toContain("bb/thread-1");
    await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("still provisions plain git sources as git worktrees", async () => {
    const sourcePath = await makeTempDir("bb-jj-plain-source-");
    await runGit(["init", "-b", "main"], { cwd: sourcePath });
    await runGit(["config", "user.name", "BB Tests"], { cwd: sourcePath });
    await runGit(["config", "user.email", "bb@example.com"], { cwd: sourcePath });
    await fs.writeFile(path.join(sourcePath, "README.md"), "hello\n", "utf8");
    await runGit(["add", "."], { cwd: sourcePath });
    await runGit(["commit", "-m", "Initial commit"], { cwd: sourcePath });

    const targetPath = await provision(sourcePath, "bb/thread-1");
    const branch = await runGit(["symbolic-ref", "--short", "HEAD"], {
      cwd: targetPath,
    });
    expect(branch.stdout.trim()).toBe("bb/thread-1");
    const hostWorkspace = await provisionWorkspace({
      workspaceProvisionType: "reconnect-managed-worktree",
      path: targetPath,
    });
    expect(hostWorkspace.vcs).toBe("git");
    await expect(fs.stat(path.join(targetPath, ".jj"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe.skipIf(!jjAvailable)("reconnecting to a jj workspace", () => {
  it("rebuilds the jj-backed workspace from the directory alone", async () => {
    const sourcePath = await initColocatedSource();
    const targetPath = await provision(sourcePath, "bb/thread-1");

    // A daemon restart reconnects with nothing but the path on disk.
    const reconnected = await provisionWorkspace({
      workspaceProvisionType: "reconnect-managed-worktree",
      path: targetPath,
    });
    await fs.writeFile(path.join(targetPath, "work.txt"), "work\n", "utf8");
    const commit = await reconnected.commit({
      message: "after restart",
      noVerify: true,
    });

    const bookmark = await runJj(
      ["log", "--no-graph", "-r", "bb/thread-1", "-T", "commit_id"],
      { cwd: sourcePath },
    );
    expect(bookmark.stdout.trim()).toBe(commit.commitSha);
  });
});
