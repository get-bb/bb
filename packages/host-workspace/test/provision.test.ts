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

    it.each([
      { linked: false, alias: false },
      { linked: true, alias: false },
      { linked: false, alias: true },
    ])(
      "serves repository-relative changes from a subfolder (linked=$linked, alias=$alias)",
      async ({ linked, alias }) => {
        const root = await initRepo(await makeTempDir("bb-subfolder-"));
        let repo = root;
        if (linked) {
          repo = path.join(
            await makeTempDir("bb-subfolder-worktree-"),
            "checkout",
          );
          await runGit(["worktree", "add", "-b", "feature", repo], {
            cwd: root,
          });
        }
        if (alias) {
          const link = path.join(
            await makeTempDir("bb-subfolder-alias-"),
            "linked-repo",
          );
          await fs.symlink(repo, link, "junction");
          repo = link;
        }
        const subfolder = path.join(repo, "packages", "app");
        await fs.mkdir(subfolder, { recursive: true });
        await fs.writeFile(path.join(subfolder, "file[1].txt"), "one\n");
        await runGit(["add", "."], { cwd: repo });
        await runGit(["commit", "-m", "nested file"], { cwd: repo });
        await fs.appendFile(path.join(subfolder, "file[1].txt"), "two\n");
        await fs.writeFile(path.join(subfolder, "new.txt"), "new content\n");
        const ws = await provisionWorkspace({ path: subfolder });
        const target = { type: "uncommitted" } as const;
        const files = await ws.diffFiles({
          target,
          maxFiles: 100,
          ignoreWhitespace: false,
        });
        expect(files.files.map((file) => file.path)).toEqual(
          expect.arrayContaining([
            "packages/app/file[1].txt",
            "packages/app/new.txt",
          ]),
        );
        const patches = await ws.diffPatch({
          target,
          paths: files.files.map((file) => file.path),
          maxBytesPerFile: 10000,
          ignoreWhitespace: false,
        });
        expect(
          patches.find((entry) => entry.path === "packages/app/file[1].txt")
            ?.patch,
        ).toContain("+two");
        expect(
          patches.find((entry) => entry.path === "packages/app/new.txt")?.patch,
        ).toContain("+new content");
        expect(ws.path).toBe(subfolder);
        expect(ws.isWorktree).toBe(linked);
        const repository = {
          root: await fs.realpath(repo),
          workspacePrefix: "packages/app/",
        };
        expect(ws.repository).toEqual(repository);
        expect((await ws.getStatus()).repository).toEqual(repository);
      },
    );

    it("throws for non-existent path", async () => {
      await expect(
        provisionWorkspace({
          path: "/tmp/does-not-exist-bb",
        }),
      ).rejects.toThrow(/does not exist/u);
    });
  });
});
