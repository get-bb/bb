import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectCheckouts, listGitWorktrees } from "./git-worktrees.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function repository() {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "bb-git-worktrees-")),
  );
  roots.push(root);
  const repo = path.join(root, "repo");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
  await fs.mkdir(repo);
  git(repo, "init", "-q");
  await fs.writeFile(path.join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  return { root, repo, git };
}

it("dates a worktree by its latest edit, not only its last git operation", async () => {
  const { root, repo, git } = await repository();
  const worktree = path.join(root, "edited");
  git(repo, "worktree", "add", "-q", "-b", "edited", worktree);
  const old = new Date(Date.now() - 30 * 86_400_000);
  for (const name of ["HEAD", "index", path.join("logs", "HEAD")])
    await fs
      .utimes(path.join(repo, ".git", "worktrees", "edited", name), old, old)
      .catch(() => undefined);
  const before = Date.now();
  await fs.writeFile(path.join(worktree, "a.txt"), "changed");

  const { repositories } = await listGitWorktrees(
    { repositoryPaths: [repo], ownedPaths: [] },
    new AbortController().signal,
  );

  const found = repositories[0]!.worktrees[0]!;
  expect(found.changedFileCount).toBe(1);
  expect(found.lastActivityAt).toBeGreaterThanOrEqual(before - 1000);
});

it("reports whether checkouts are missing, clean, or have uncommitted changes", async () => {
  const { root, repo, git } = await repository();
  const clean = path.join(root, "clean");
  const changed = path.join(root, "changed");
  git(repo, "worktree", "add", "-q", "-b", "clean", clean);
  git(repo, "worktree", "add", "-q", "-b", "changed", changed);
  await fs.writeFile(path.join(changed, "new.txt"), "x");
  const plain = path.join(root, "plain");
  await fs.mkdir(plain);

  const { checkouts } = await inspectCheckouts(
    { paths: [clean, changed, path.join(root, "gone"), plain] },
    new AbortController().signal,
  );

  expect(checkouts).toEqual([
    { path: clean, state: "clean" },
    { path: changed, state: "changed", changedFileCount: 1 },
    { path: path.join(root, "gone"), state: "missing" },
    { path: plain, state: "notGit" },
  ]);
});
