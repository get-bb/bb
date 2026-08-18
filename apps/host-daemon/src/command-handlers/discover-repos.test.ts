import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverRepos } from "./discover-repos.js";

/**
 * The walk's whole value is what it refuses to enter, so these cover the
 * skip rules rather than the happy path.
 */
describe("discoverRepos", () => {
  let home: string;

  const makeRepo = async (relativePath: string) => {
    const gitDir = join(home, relativePath, ".git");
    await mkdir(gitDir, { recursive: true });
    await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  };

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "bb-discover-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const run = () =>
    discoverRepos({
      maxDepth: 5,
      sinceDays: 3650,
      limit: 50,
      home,
      env: { PATH: "/nonexistent" },
    });

  it("stops descending at a repo root so nested checkouts are not listed", async () => {
    await makeRepo("projects/app");
    await makeRepo("projects/app/vendor/inner");

    const { repos } = await run();

    expect(repos.map((repo) => repo.name)).toEqual(["app"]);
  });

  it("skips dot-directories, which hold tool internals rather than projects", async () => {
    await makeRepo("projects/app");
    await makeRepo(".nvm/versions/thing");
    await makeRepo(".bb-dev/worktrees/copy");

    const { repos } = await run();

    expect(repos.map((repo) => repo.name)).toEqual(["app"]);
  });

  it("skips heavy build directories on the way down", async () => {
    await makeRepo("projects/app");
    await makeRepo("code/node_modules/pkg");

    const { repos } = await run();

    expect(repos.map((repo) => repo.name)).toEqual(["app"]);
  });

  it("drops repos older than the recency window", async () => {
    await makeRepo("projects/app");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    try {
      const { repos } = await discoverRepos({
        maxDepth: 5,
        sinceDays: 30,
        limit: 50,
        home,
        env: { PATH: "/nonexistent" },
        // A "now" far in the future puts the fixture outside the window.
        now: Date.now() + 400 * 86_400_000,
      });

      expect(repos).toEqual([]);
      const timerDelays = setTimeoutSpy.mock.calls.flatMap(([, delay]) =>
        typeof delay === "number" ? [delay] : [],
      );
      expect(timerDelays.length).toBeGreaterThan(0);
      expect(Math.max(...timerDelays)).toBeLessThanOrEqual(3_000);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it("detects linked worktrees, whose .git is a file rather than a directory", async () => {
    // `git worktree add` and submodules both write a `.git` file pointing at
    // the real git dir. Treating only directories as repo markers walked
    // straight into them and returned nothing.
    await mkdir(join(home, "projects/linked"), { recursive: true });
    await writeFile(
      join(home, "projects/linked/.git"),
      "gitdir: /home/user/projects/app/.git/worktrees/linked\n",
    );

    const { repos } = await run();

    expect(repos.map((repo) => repo.name)).toEqual(["linked"]);
  });

  it("still returns repos when no agent history is available", async () => {
    await makeRepo("projects/app");

    const { repos, truncated } = await run();

    expect(truncated).toBe(false);
    expect(repos[0]?.agentSeen).toBe(false);
    expect(repos[0]?.agentSeenAt).toBeNull();
  });
});
