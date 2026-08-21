import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectColocatedJjSource,
  resolveJjWorkspaceLayout,
  runJj,
} from "../src/jj.js";
import { runGit } from "../src/git.js";

const execFileAsync = promisify(execFile);

const jjAvailable = await execFileAsync("jj", ["--version"]).then(
  () => true,
  () => false,
);

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  // macOS temp dirs are symlinked through /private; resolve so path
  // comparisons against jj's own output match.
  return await fs.realpath(dir);
}

async function initColocatedJjSource(): Promise<string> {
  const repoPath = await makeTempDir("bb-jj-source-");
  await runJj(["git", "init", "--colocate"], { cwd: repoPath });
  await runJj(["config", "set", "--repo", "user.name", "BB Tests"], {
    cwd: repoPath,
  });
  await runJj(["config", "set", "--repo", "user.email", "bb@example.com"], {
    cwd: repoPath,
  });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runJj(["commit", "-m", "Initial commit"], { cwd: repoPath });
  await runJj(["bookmark", "create", "main", "-r", "@-"], { cwd: repoPath });
  return repoPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe.skipIf(!jjAvailable)("jj workspace layout", () => {
  it("resolves a secondary workspace back to its source repository", async () => {
    const sourcePath = await initColocatedJjSource();
    const parent = await makeTempDir("bb-jj-workspaces-");
    const workspacePath = path.join(parent, "thread");
    await runJj(
      ["workspace", "add", "--name", "bb/thread-1", workspacePath, "-r", "main"],
      { cwd: sourcePath },
    );

    const layout = await resolveJjWorkspaceLayout(workspacePath);
    expect(layout).toEqual({
      kind: "secondary",
      repoPath: path.join(sourcePath, ".jj", "repo"),
      sourcePath,
    });
    // A secondary workspace has no git repository of its own.
    await expect(
      fs.lstat(path.join(workspacePath, ".git")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports the main workspace and recognizes it as a provisioning source", async () => {
    const sourcePath = await initColocatedJjSource();

    expect(await resolveJjWorkspaceLayout(sourcePath)).toEqual({
      kind: "main",
      repoPath: path.join(sourcePath, ".jj", "repo"),
      sourcePath,
    });
    expect(await detectColocatedJjSource(sourcePath)).toBe(true);
  });

  it("refuses a plain git repository and a bb-managed worktree as jj sources", async () => {
    const repoPath = await makeTempDir("bb-jj-plain-");
    await runGit(["init", "-b", "main"], { cwd: repoPath });
    await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
    await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
    await runGit(["add", "README.md"], { cwd: repoPath });
    await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });

    expect(await resolveJjWorkspaceLayout(repoPath)).toBeNull();
    expect(await detectColocatedJjSource(repoPath)).toBe(false);

    const jjSource = await initColocatedJjSource();
    const parent = await makeTempDir("bb-jj-worktree-parent-");
    const worktreePath = path.join(parent, "feature");
    await runGit(["worktree", "add", "-B", "bb/test", worktreePath, "main"], {
      cwd: jjSource,
    });
    // A git worktree of a jj repo carries no .jj, so it stays plain git.
    expect(await resolveJjWorkspaceLayout(worktreePath)).toBeNull();
  });

  it("surfaces jj failures as typed workspace errors", async () => {
    const repoPath = await makeTempDir("bb-jj-not-a-repo-");

    await expect(runJj(["status"], { cwd: repoPath })).rejects.toMatchObject({
      name: "WorkspaceError",
      code: "jj_command_failed",
    });
    const allowed = await runJj(["status"], {
      cwd: repoPath,
      allowFailure: true,
    });
    expect(allowed.exitCode).not.toBe(0);
  });
});
