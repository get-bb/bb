import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchOnlineRpcCommand } from "../../src/command-dispatch.js";
import {
  cleanupTempDirs,
  createHarness,
  makeTempDir,
  runGitCommand,
} from "./dispatch-helpers.js";

afterEach(cleanupTempDirs);

async function initWorktreeRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-host-worktrees-repo-");
  await runGitCommand(["init", "-b", "main"], { cwd: repoPath });
  await runGitCommand(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGitCommand(["config", "user.email", "bb@example.com"], {
    cwd: repoPath,
  });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGitCommand(["add", "."], { cwd: repoPath });
  await runGitCommand(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

describe("host.list_worktrees dispatch", () => {
  it("returns worktree facts and resolved comparison paths", async () => {
    const repoPath = await initWorktreeRepo();
    await runGitCommand(["branch", "feature"], { cwd: repoPath });
    const worktreeParent = await makeTempDir("bb-host-worktrees-target-");
    const worktreePath = path.join(worktreeParent, "feature");
    await runGitCommand(["worktree", "add", worktreePath, "feature"], {
      cwd: repoPath,
    });
    const missingComparisonPath = path.join(worktreeParent, "gone");
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_worktrees",
        path: repoPath,
        comparisonPaths: [worktreePath, missingComparisonPath],
      },
      harness.dispatchOptions(),
    );

    expect(result.worktrees).toHaveLength(2);
    expect(result.worktrees[0].checkout).toEqual({
      kind: "branch",
      branchName: "main",
    });
    expect(result.worktrees[1]).toMatchObject({
      canonicalPath: await fs.realpath(worktreePath),
      checkout: { kind: "branch", branchName: "feature" },
      lock: null,
      prunable: null,
    });
    expect(result.resolvedPaths).toEqual([
      { path: worktreePath, canonicalPath: await fs.realpath(worktreePath) },
      { path: missingComparisonPath, canonicalPath: null },
    ]);
  });

  it("rejects a relative source path with invalid_path", async () => {
    const harness = createHarness();

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "host.list_worktrees",
          path: "relative/repo",
          comparisonPaths: [],
        },
        harness.dispatchOptions(),
      ),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("rejects a relative comparison path with invalid_path", async () => {
    const repoPath = await initWorktreeRepo();
    const harness = createHarness();

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "host.list_worktrees",
          path: repoPath,
          comparisonPaths: ["relative/env"],
        },
        harness.dispatchOptions(),
      ),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("fails with a structured code for a non-repository path", async () => {
    const plainDir = await makeTempDir("bb-host-worktrees-plain-");
    const harness = createHarness();

    await expect(
      dispatchOnlineRpcCommand(
        {
          type: "host.list_worktrees",
          path: plainDir,
          comparisonPaths: [],
        },
        harness.dispatchOptions(),
      ),
    ).rejects.toMatchObject({ code: "not_git_repo" });
  });
});
