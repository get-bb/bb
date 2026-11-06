import fs from "node:fs/promises";
import path from "node:path";
import { initRepo, makeTempDir } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import { listBranchOptions } from "../src/branch-options.js";
import { runGit } from "../src/workspace-git.js";

const AGED_BY_MS = 60_000;

async function ageRefStore(repo: string): Promise<void> {
  const aged = new Date(Date.now() - AGED_BY_MS);
  const gitDir = path.join(repo, ".git");
  await fs.utimes(path.join(gitDir, "packed-refs"), aged, aged).catch(() => {});
  const pending = ["refs/heads", "refs/remotes"].map((dir) =>
    path.join(gitDir, dir),
  );
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    const children = await fs
      .readdir(dir, { withFileTypes: true })
      .catch(() => null);
    if (children === null) continue;
    await fs.utimes(dir, aged, aged);
    for (const child of children) {
      if (child.isDirectory()) pending.push(path.join(dir, child.name));
    }
  }
}

async function listNames(
  repo: string,
  shellPath?: string,
): Promise<{ local: string[]; remote: string[] }> {
  const result = await listBranchOptions({
    path: repo,
    limit: 50,
    remoteRefresh: "none",
    ...(shellPath === undefined ? {} : { shellPath }),
  });
  return { local: result.branches, remote: result.remoteBranches };
}

async function newRepo(): Promise<string> {
  return initRepo(await makeTempDir("bb-branch-options-cache-"));
}

describe("branch option listing across ref changes", () => {
  it("lists a branch created after the refs were last listed", async () => {
    const repo = await newRepo();
    await ageRefStore(repo);
    expect((await listNames(repo)).local).toEqual(["main"]);

    await runGit(["branch", "feature/new"], { cwd: repo });

    expect((await listNames(repo)).local).toEqual(["main", "feature/new"]);
  });

  it("drops a branch deleted from packed-refs after the refs were last listed", async () => {
    const repo = await newRepo();
    await runGit(["branch", "packed-only"], { cwd: repo });
    await runGit(["pack-refs", "--all"], { cwd: repo });
    await ageRefStore(repo);
    expect((await listNames(repo)).local).toEqual(["main", "packed-only"]);

    await runGit(["branch", "-D", "packed-only"], { cwd: repo });

    expect((await listNames(repo)).local).toEqual(["main"]);
  });

  it("lists branches of a remote fetched for the first time after the refs were last listed", async () => {
    const repo = await newRepo();
    const remote = await makeTempDir("bb-branch-options-cache-remote-");
    await runGit(["init", "--bare", "-q"], { cwd: remote });
    await runGit(["push", "-q", remote, "main"], { cwd: repo });
    await ageRefStore(repo);
    expect((await listNames(repo)).remote).toEqual([]);

    await runGit(["remote", "add", "upstream", remote], { cwd: repo });
    await runGit(["fetch", "-q", "upstream"], { cwd: repo });

    expect((await listNames(repo)).remote).toEqual(["upstream/main"]);
  });

  it("shares one listing between worktrees of a repository", async () => {
    const repo = await newRepo();
    const worktree = path.join(
      await makeTempDir("bb-branch-options-cache-worktree-"),
      "linked",
    );
    await runGit(["worktree", "add", "-q", "-b", "linked", worktree], {
      cwd: repo,
    });
    await ageRefStore(repo);
    expect((await listNames(worktree)).local).toEqual(["main", "linked"]);

    await runGit(["branch", "from-main-checkout"], { cwd: repo });

    expect((await listNames(worktree)).local).toEqual([
      "main",
      "from-main-checkout",
      "linked",
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "answers repeat searches without listing refs again while they are unchanged",
    async () => {
      const repo = await newRepo();
      await runGit(["branch", "feature/search"], { cwd: repo });
      await ageRefStore(repo);
      const shimDir = await makeTempDir("bb-branch-options-cache-shim-");
      const log = path.join(shimDir, "git.log");
      const inheritedPath = process.env.PATH ?? "";
      await fs.writeFile(
        path.join(shimDir, "git"),
        `#!/bin/sh\necho "$1" >> ${JSON.stringify(log)}\nPATH=${JSON.stringify(inheritedPath)} exec git "$@"\n`,
        { mode: 0o755 },
      );
      const shellPath = `${shimDir}${path.delimiter}${inheritedPath}`;
      const forEachRefCalls = async () =>
        (await fs.readFile(log, "utf8").catch(() => ""))
          .split("\n")
          .filter((command) => command === "for-each-ref").length;

      await listNames(repo, shellPath);
      expect(await forEachRefCalls()).toBe(2);
      const result = await listBranchOptions({
        path: repo,
        limit: 50,
        remoteRefresh: "none",
        query: "search",
        shellPath,
      });

      expect(result.branches).toEqual(["feature/search"]);
      expect(await forEachRefCalls()).toBe(2);
    },
  );
});
