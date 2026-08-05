import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WORKTREE_INCLUDE_FILE_NAME } from "@bb/domain";
import { createWorktree } from "../src/provisioning.js";
import { runGit } from "../src/git.js";
import { copyWorktreeIncludeFiles } from "../src/worktree-include.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function writeFile(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

/** Repo with a committed `.gitignore` plus the given tracked extra files. */
async function initRepo(gitignore: string): Promise<string> {
  const repoPath = await makeTempDir("bb-worktree-include-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await writeFile(path.join(repoPath, "README.md"), "hello\n");
  await writeFile(path.join(repoPath, ".gitignore"), gitignore);
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("copyWorktreeIncludeFiles", () => {
  it("copies gitignored matches and leaves unmatched files behind", async () => {
    const sourcePath = await initRepo(".env*\nsecrets/\nbuild/\n");
    await writeFile(path.join(sourcePath, ".env"), "TOKEN=1\n");
    await writeFile(path.join(sourcePath, ".env.local"), "TOKEN=2\n");
    await writeFile(path.join(sourcePath, "secrets/key.pem"), "pem\n");
    await writeFile(path.join(sourcePath, "build/output.js"), "built\n");
    await writeFile(
      path.join(sourcePath, WORKTREE_INCLUDE_FILE_NAME),
      "# local credentials\n\n.env*\nsecrets/\n",
    );
    const targetPath = await makeTempDir("bb-worktree-include-target-");

    const result = await copyWorktreeIncludeFiles({ sourcePath, targetPath });

    expect(result.ran).toBe(true);
    expect([...result.copied].sort()).toEqual([
      ".env",
      ".env.local",
      "secrets/key.pem",
    ]);
    await expect(
      fs.readFile(path.join(targetPath, "secrets/key.pem"), "utf8"),
    ).resolves.toBe("pem\n");
    await expect(
      fs.stat(path.join(targetPath, "build/output.js")),
    ).rejects.toThrow();
  });

  it("honours negation patterns the way gitignore does", async () => {
    const sourcePath = await initRepo("secrets/\n");
    await writeFile(path.join(sourcePath, "secrets/keep.pem"), "keep\n");
    await writeFile(path.join(sourcePath, "secrets/skip.pem"), "skip\n");
    await writeFile(
      path.join(sourcePath, WORKTREE_INCLUDE_FILE_NAME),
      "secrets/*.pem\n!secrets/skip.pem\n",
    );
    const targetPath = await makeTempDir("bb-worktree-include-target-");

    const result = await copyWorktreeIncludeFiles({ sourcePath, targetPath });

    expect(result.copied).toEqual(["secrets/keep.pem"]);
  });

  it("skips symlinks instead of copying what they point at", async () => {
    const sourcePath = await initRepo(".env\n");
    const outsideDir = await makeTempDir("bb-worktree-include-outside-");
    await writeFile(path.join(outsideDir, "real.env"), "OUTSIDE=1\n");
    await fs.symlink(
      path.join(outsideDir, "real.env"),
      path.join(sourcePath, ".env"),
    );
    await writeFile(
      path.join(sourcePath, WORKTREE_INCLUDE_FILE_NAME),
      ".env\n",
    );
    const targetPath = await makeTempDir("bb-worktree-include-target-");

    const result = await copyWorktreeIncludeFiles({ sourcePath, targetPath });

    expect(result.copied).toEqual([]);
    expect(result.skipped).toEqual([".env: symlink"]);
    await expect(fs.stat(path.join(targetPath, ".env"))).rejects.toThrow();
  });

  it("does nothing when the file holds no patterns", async () => {
    const sourcePath = await initRepo(".env\n");
    await writeFile(path.join(sourcePath, ".env"), "TOKEN=1\n");
    await writeFile(
      path.join(sourcePath, WORKTREE_INCLUDE_FILE_NAME),
      "# nothing here\n\n",
    );
    const targetPath = await makeTempDir("bb-worktree-include-target-");

    const result = await copyWorktreeIncludeFiles({ sourcePath, targetPath });

    expect(result).toEqual({ ran: false, copied: [], skipped: [] });
    await expect(fs.stat(path.join(targetPath, ".env"))).rejects.toThrow();
  });
});

describe("createWorktree with .worktreeinclude", () => {
  it("copies the files before the setup script reads them", async () => {
    const sourcePath = await initRepo(".env\n");
    await writeFile(
      path.join(sourcePath, ".bb-env-setup.sh"),
      "set -eu\ncp .env copied-by-setup\n",
    );
    await writeFile(
      path.join(sourcePath, WORKTREE_INCLUDE_FILE_NAME),
      ".env\n",
    );
    await runGit(["add", "."], { cwd: sourcePath });
    await runGit(["commit", "-m", "Add setup script"], { cwd: sourcePath });
    await writeFile(path.join(sourcePath, ".env"), "TOKEN=1\n");
    const parentDir = await makeTempDir("bb-worktree-include-parent-");
    const targetPath = path.join(parentDir, "feature");

    await createWorktree({
      sourcePath,
      targetPath,
      branchName: "feature",
      baseBranch: "main",
      timeoutMs: 900000,
    });

    await expect(
      fs.readFile(path.join(targetPath, "copied-by-setup"), "utf8"),
    ).resolves.toBe("TOKEN=1\n");
  });

  it("still provisions when a listed file is missing", async () => {
    const sourcePath = await initRepo(".env\n");
    await writeFile(
      path.join(sourcePath, WORKTREE_INCLUDE_FILE_NAME),
      ".env\n",
    );
    const parentDir = await makeTempDir("bb-worktree-include-parent-");
    const targetPath = path.join(parentDir, "feature");

    await createWorktree({
      sourcePath,
      targetPath,
      branchName: "feature",
      baseBranch: "main",
      timeoutMs: 900000,
    });

    await expect(
      fs.stat(path.join(targetPath, "README.md")),
    ).resolves.toBeDefined();
    await expect(fs.stat(path.join(targetPath, ".env"))).rejects.toThrow();
  });
});
