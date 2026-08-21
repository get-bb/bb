import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../src/workspace.js";
import { getCheckoutRef, runGit } from "../src/git.js";

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
  const repoPath = await makeTempDir("bb-jj-colocated-repo-");
  await runJj(["git", "init", "--colocate"], repoPath);
  await runJj(["config", "set", "--repo", "user.name", "BB Tests"], repoPath);
  await runJj(
    ["config", "set", "--repo", "user.email", "bb@example.com"],
    repoPath,
  );
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runJj(["commit", "-m", "Initial commit"], repoPath);
  return repoPath;
}

async function initPlainGitRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-jj-plain-git-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "README.md"], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true }),
    ),
  );
});

describe.skipIf(!jjAvailable)("colocated jj workspaces", () => {
  it("reports a detached checkout with the bookmark pointing at HEAD", async () => {
    const repoPath = await initColocatedJjRepo();
    await runJj(["bookmark", "create", "feature", "-r", "@-"], repoPath);

    const checkout = await getCheckoutRef(repoPath);
    expect(checkout).toEqual({
      kind: "detached",
      headSha: expect.any(String),
      jj: { bookmark: "feature" },
    });
  });

  it("picks the lexicographically first bookmark when several point at HEAD", async () => {
    const repoPath = await initColocatedJjRepo();
    await runJj(["bookmark", "create", "zebra", "-r", "@-"], repoPath);
    await runJj(["bookmark", "create", "alpha", "-r", "@-"], repoPath);

    const checkout = await getCheckoutRef(repoPath);
    expect(checkout).toMatchObject({ jj: { bookmark: "alpha" } });
  });

  it("reports a null bookmark when no bookmark points at HEAD", async () => {
    const repoPath = await initColocatedJjRepo();
    await runJj(["bookmark", "create", "old", "-r", "@-"], repoPath);
    await fs.writeFile(path.join(repoPath, "later.txt"), "later\n", "utf8");
    await runJj(["commit", "-m", "Second commit"], repoPath);

    const checkout = await getCheckoutRef(repoPath);
    expect(checkout).toMatchObject({
      kind: "detached",
      jj: { bookmark: null },
    });
  });

  it("does not add the jj field in a plain git repo", async () => {
    const repoPath = await initPlainGitRepo();
    await runGit(["checkout", "--detach"], { cwd: repoPath });

    const checkout = await getCheckoutRef(repoPath);
    expect(checkout.kind).toBe("detached");
    expect(checkout).not.toHaveProperty("jj");
  });

  it("treats a managed worktree of a jj repo as a plain git branch checkout", async () => {
    const repoPath = await initColocatedJjRepo();
    await runJj(["bookmark", "create", "main", "-r", "@-"], repoPath);
    const worktreeParent = await makeTempDir("bb-jj-worktree-parent-");
    const worktreePath = path.join(worktreeParent, "feature");
    await runGit(["worktree", "add", "-B", "bb/test", worktreePath, "main"], {
      cwd: repoPath,
    });

    const checkout = await getCheckoutRef(worktreePath);
    expect(checkout).toMatchObject({ kind: "branch", branchName: "bb/test" });
    expect(checkout).not.toHaveProperty("jj");
  });

  it("reports @'s snapshotted edits as uncommitted changes in getStatus", async () => {
    const repoPath = await initColocatedJjRepo();
    await runJj(["bookmark", "create", "main", "-r", "@-"], repoPath);
    await fs.writeFile(path.join(repoPath, "README.md"), "changed\n", "utf8");
    await fs.writeFile(path.join(repoPath, "new.txt"), "new\n", "utf8");
    // Force a jj snapshot so the edits live in @ and git sees them as
    // unstaged + intent-to-add entries relative to HEAD (= @-).
    await runJj(["status"], repoPath);

    const workspace = new Workspace(repoPath);
    const status = await workspace.getStatus();
    expect(status.checkout).toMatchObject({
      kind: "detached",
      jj: { bookmark: "main" },
    });
    expect(status.workingTree.hasUncommittedChanges).toBe(true);
    const filePaths = status.workingTree.files.map((file) => file.path).sort();
    expect(filePaths).toEqual(["README.md", "new.txt"]);
  });
});
