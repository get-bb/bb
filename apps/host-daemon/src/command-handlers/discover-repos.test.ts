import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRepos } from "./discover-repos.js";

const DAY_MS = 86_400_000;

describe("discoverRepos", () => {
  let home: string;

  const makeRepo = async (
    relativePath: string,
    options: { headAgeDays?: number; origin?: string } = {},
  ) => {
    const gitDir = join(home, relativePath, ".git");
    await mkdir(gitDir, { recursive: true });
    const headPath = join(gitDir, "HEAD");
    await writeFile(headPath, "ref: refs/heads/main\n");
    if (options.headAgeDays !== undefined) {
      const at = new Date(Date.now() - options.headAgeDays * DAY_MS);
      await utimes(headPath, at, at);
    }
    if (options.origin !== undefined) {
      await writeFile(
        join(gitDir, "config"),
        `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${options.origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n`,
      );
    }
  };

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bb-discover-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const run = (overrides: { sinceDays?: number; limit?: number } = {}) =>
    discoverRepos({
      maxDepth: 5,
      sinceDays: overrides.sinceDays ?? 3650,
      limit: overrides.limit ?? 50,
      home,
    });

  it("stops descending at a repo root so nested checkouts are not listed", async () => {
    await makeRepo("projects/app");
    await makeRepo("projects/app/vendor/inner");

    const { repos, truncated } = await run();

    expect(truncated).toBe(false);
    expect(repos.map((repo) => repo.path)).toEqual([
      join(home, "projects/app"),
    ]);
  });

  it("skips dot-directories, build directories, and scratch directories on the way down", async () => {
    await makeRepo("projects/app");
    await makeRepo(".nvm/versions/thing");
    await makeRepo("code/node_modules/pkg");
    await makeRepo("tmp/clone");
    await makeRepo("tmp-review/clone");
    await makeRepo("Downloads/sample");

    const { repos } = await run();

    expect(repos.map((repo) => repo.name)).toEqual(["app"]);
  });

  it("skips linked worktrees and submodules, whose .git is a file", async () => {
    await makeRepo("projects/app");
    await mkdir(join(home, "projects/linked"), { recursive: true });
    await writeFile(
      join(home, "projects/linked/.git"),
      "gitdir: /home/user/projects/app/.git/worktrees/linked\n",
    );

    const { repos } = await run();

    expect(repos.map((repo) => repo.name)).toEqual(["app"]);
  });

  it("keeps looking below a home folder that is itself a git repo", async () => {
    await mkdir(join(home, ".git"), { recursive: true });
    await writeFile(join(home, ".git", "HEAD"), "ref: refs/heads/main\n");
    await makeRepo("projects/app");
    await makeRepo("code/site");

    const { repos } = await run();

    expect(repos.map((repo) => repo.name).sort()).toEqual(["app", "site"]);
  });

  it("finds every repo in a directory wider than the open-directory limit", async () => {
    const names = Array.from({ length: 70 }, (_, index) => `repo-${index}`);
    await Promise.all(names.map((name) => makeRepo(`projects/${name}`)));

    const { repos, truncated } = await run({ limit: 200 });

    expect(truncated).toBe(false);
    expect(repos.map((repo) => repo.name).sort()).toEqual([...names].sort());
  });

  it("does not list repos deeper than maxDepth", async () => {
    await makeRepo("a/b/c/d/e/too-deep");
    await makeRepo("a/b/c/d/reachable");

    const { repos } = await run();

    expect(repos.map((repo) => repo.name)).toEqual(["reachable"]);
  });

  it("drops repos outside the recency window and orders the rest newest first", async () => {
    await makeRepo("projects/stale", { headAgeDays: 90 });
    await makeRepo("projects/older", { headAgeDays: 10 });
    await makeRepo("projects/newest", { headAgeDays: 1 });

    const { repos } = await run({ sinceDays: 30 });

    expect(repos.map((repo) => repo.name)).toEqual(["newest", "older"]);
  });

  it("uses the most recent of HEAD, index, and the HEAD reflog as activity", async () => {
    await makeRepo("projects/committed", { headAgeDays: 90 });
    await mkdir(join(home, "projects/committed/.git/logs"), {
      recursive: true,
    });
    await writeFile(join(home, "projects/committed/.git/logs/HEAD"), "");

    const { repos } = await run({ sinceDays: 30 });

    expect(repos.map((repo) => repo.name)).toEqual(["committed"]);
  });

  it("keeps only the newest repos when more than the limit are found", async () => {
    await makeRepo("projects/one", { headAgeDays: 3 });
    await makeRepo("projects/two", { headAgeDays: 2 });
    await makeRepo("projects/three", { headAgeDays: 1 });

    const { repos } = await run({ limit: 2 });

    expect(repos.map((repo) => repo.name)).toEqual(["three", "two"]);
  });

  it("reads the origin remote and reports null when there is none", async () => {
    await makeRepo("projects/with-remote", {
      headAgeDays: 1,
      origin: "git@github.com:example/with-remote.git",
    });
    await makeRepo("projects/local-only", { headAgeDays: 2 });

    const { repos } = await run();

    expect(repos.map((repo) => [repo.name, repo.originUrl])).toEqual([
      ["with-remote", "git@github.com:example/with-remote.git"],
      ["local-only", null],
    ]);
  });

  it("reports truncated when the walk budget is already spent", async () => {
    await makeRepo("projects/app");

    const result = await discoverRepos({
      maxDepth: 5,
      sinceDays: 3650,
      limit: 50,
      home,
      walkBudgetMs: -1,
    });

    expect(result).toEqual({ repos: [], truncated: true });
  });
});
