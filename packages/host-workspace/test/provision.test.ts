import path from "node:path";
import fs from "node:fs/promises";
import { initRepo, makeTempDir } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { provisionWorkspace } from "../src/index.js";
import { runGit } from "../src/git.js";

describe("provisionWorkspace", () => {
  describe("unmanaged", () => {
    it("provisions an unmanaged git repo and discovers properties", async () => {
      const repoPath = await initRepo(await makeTempDir("bb-provision-repo-"));

      const ws = await provisionWorkspace({
        path: repoPath,
      });

      expect(ws.path).toBe(repoPath);
      expect(ws.isGitRepo).toBe(true);
      expect(ws.isWorktree).toBe(false);
      expect(await ws.getCurrentBranch()).toBe("main");
    });

    it.each([false, true])(
      "reports no checkout for a plain directory or bare repository: %s",
      async (bare) => {
        const dirPath = await makeTempDir("bb-provision-nongit-");
        if (bare) await runGit(["init", "--bare"], { cwd: dirPath });

        const ws = await provisionWorkspace({
          path: dirPath,
        });

        expect(ws.isGitRepo).toBe(false);
        expect(ws.isWorktree).toBe(false);
      },
    );

    it.each([
      "repo",
      "repo with spaces",
      ...(process.platform === "win32" ? [] : ["repo\nnewline"]),
    ])(
      "detects a linked worktree with repository directory %j",
      async (directory) => {
        const repoPath = path.join(
          await makeTempDir("bb-provision-repo-"),
          directory,
        );
        await fs.mkdir(repoPath);
        await initRepo(repoPath);
        const parentDir = await makeTempDir("bb-provision-wt-parent-");
        const wtPath = path.join(parentDir, "wt");
        await runGit(["worktree", "add", "-B", "feature", wtPath], {
          cwd: repoPath,
        });

        const ws = await provisionWorkspace({
          path: wtPath,
        });

        expect(ws.isGitRepo).toBe(true);
        expect(ws.isWorktree).toBe(true);
      },
    );

    it("resolves external git metadata roots for unmanaged worktrees", async () => {
      const repoPath = await initRepo(await makeTempDir("bb-provision-repo-"));
      const parentDir = await makeTempDir("bb-provision-unmanaged-wt-roots-");
      const wtPath = path.join(parentDir, "wt");
      await runGit(["worktree", "add", "-B", "feature", wtPath], {
        cwd: repoPath,
      });
      const ws = await provisionWorkspace({
        path: wtPath,
      });
      const gitDir = (
        await runGit(["rev-parse", "--absolute-git-dir"], { cwd: ws.path })
      ).stdout.trim();
      const commonGitDir = path.resolve(
        ws.path,
        (
          await runGit(["rev-parse", "--git-common-dir"], { cwd: ws.path })
        ).stdout.trim(),
      );

      await expect(ws.getAdditionalWorkspaceWriteRoots()).resolves.toEqual([
        path.resolve(gitDir),
        path.join(commonGitDir, "objects"),
        path.join(commonGitDir, "refs"),
        path.join(commonGitDir, "logs"),
      ]);
    });

    it("throws for non-existent path", async () => {
      await expect(
        provisionWorkspace({
          path: "/tmp/does-not-exist-bb",
        }),
      ).rejects.toThrow(/does not exist/u);
    });
  });
});
