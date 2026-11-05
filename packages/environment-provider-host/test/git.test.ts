import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readGitRepositoryState, runGit } from "../src/git.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-repo-state-"));
  tempDirs.push(dir);
  return dir;
}

async function initRepo() {
  const repoPath = await makeTempDir();
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  return repoPath;
}

async function commitFile(repoPath: string) {
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
}

describe("readGitRepositoryState", () => {
  it.each([
    { name: "a plain directory", expected: "not_git", setup: makeTempDir },
    { name: "an empty repository", expected: "no_commits", setup: initRepo },
    {
      name: "a repository with a commit on HEAD",
      expected: "has_commits",
      setup: async () => {
        const repoPath = await initRepo();
        await commitFile(repoPath);
        return repoPath;
      },
    },
    {
      name: "an unborn HEAD with commits on another branch",
      expected: "has_commits",
      setup: async () => {
        const repoPath = await initRepo();
        await commitFile(repoPath);
        await runGit(["switch", "--orphan", "fresh"], { cwd: repoPath });
        return repoPath;
      },
    },
    {
      name: "a bare clone",
      expected: "has_commits",
      setup: async () => {
        const repoPath = await initRepo();
        await commitFile(repoPath);
        const barePath = await makeTempDir();
        await runGit(["clone", "--bare", repoPath, barePath], {
          cwd: repoPath,
        });
        return barePath;
      },
    },
  ])("reports $expected for $name", async ({ expected, setup }) => {
    expect(await readGitRepositoryState(await setup())).toBe(expected);
  });
});
