import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { deleteThreadStorage } from "../src/thread-storage.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

async function initRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-thread-storage-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], {
    cwd: repoPath,
  });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("deleteThreadStorage", () => {
  it("unregisters nested linked worktrees before deleting thread storage", async () => {
    const sourceRepo = await initRepo();
    const threadStorageRootPath = await makeTempDir("bb-thread-storage-root-");
    const outsideRoot = await makeTempDir("bb-thread-storage-outside-");
    const threadStoragePath = path.join(threadStorageRootPath, "thr_delete");
    const nestedWorktreePath = path.join(
      threadStoragePath,
      "qa",
      "nested-worktree",
    );
    const outsideWorktreePath = path.join(outsideRoot, "kept-worktree");

    await fs.mkdir(path.dirname(nestedWorktreePath), { recursive: true });
    await runGit(
      ["worktree", "add", "-b", "nested-worktree", nestedWorktreePath],
      { cwd: sourceRepo },
    );
    await runGit(
      ["worktree", "add", "-b", "outside-worktree", outsideWorktreePath],
      { cwd: sourceRepo },
    );
    await fs.writeFile(
      path.join(nestedWorktreePath, "dirty.txt"),
      "remove me\n",
      "utf8",
    );

    await deleteThreadStorage({
      threadStorageRootPath,
      threadId: "thr_delete",
    });

    await expect(fs.stat(threadStoragePath)).rejects.toThrow();
    await expect(fs.stat(outsideWorktreePath)).resolves.toBeDefined();
    const worktrees = await runGit(["worktree", "list", "--porcelain"], {
      cwd: sourceRepo,
    });
    expect(worktrees.stdout).not.toContain(nestedWorktreePath);
    expect(worktrees.stdout).toContain(outsideWorktreePath);

    await expect(
      deleteThreadStorage({
        threadStorageRootPath,
        threadId: "thr_delete",
      }),
    ).resolves.toBeUndefined();
  });

  it("deletes ordinary clones with the rest of thread storage", async () => {
    const sourceRepo = await initRepo();
    const threadStorageRootPath = await makeTempDir(
      "bb-thread-storage-clone-root-",
    );
    const threadStoragePath = path.join(threadStorageRootPath, "thr_clone");
    const clonePath = path.join(threadStoragePath, "auxiliary-clone");
    await fs.mkdir(threadStoragePath, { recursive: true });
    await runGit(["clone", sourceRepo, clonePath], {
      cwd: threadStoragePath,
    });

    await deleteThreadStorage({
      threadStorageRootPath,
      threadId: "thr_clone",
    });

    await expect(fs.stat(threadStoragePath)).rejects.toThrow();
    await expect(fs.stat(sourceRepo)).resolves.toBeDefined();
  });

  it("rejects thread ids that do not name one exact child directory", async () => {
    const parentPath = await makeTempDir("bb-thread-storage-safety-");
    const threadStorageRootPath = path.join(parentPath, "thread-storage");
    const outsidePath = path.join(parentPath, "outside");
    await fs.mkdir(threadStorageRootPath);
    await fs.mkdir(outsidePath);
    await fs.writeFile(path.join(outsidePath, "keep.txt"), "keep\n", "utf8");

    await expect(
      deleteThreadStorage({
        threadStorageRootPath,
        threadId: "../outside",
      }),
    ).rejects.toMatchObject({ code: "invalid_thread_storage_path" });
    await expect(
      fs.readFile(path.join(outsidePath, "keep.txt"), "utf8"),
    ).resolves.toBe("keep\n");
  });
});
