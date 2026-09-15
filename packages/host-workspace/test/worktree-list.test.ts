import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import {
  listGitWorktrees,
  parseGitWorktreeListOutput,
  resolveHostPaths,
} from "../src/worktree-list.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo() {
  const repoPath = await makeTempDir("bb-worktree-list-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

async function addWorktree(
  repoPath: string,
  name: string,
  target: { branch?: string; detach?: boolean },
) {
  const parent = await makeTempDir("bb-worktree-target-");
  const worktreePath = path.join(parent, name);
  await runGit(
    [
      "worktree",
      "add",
      ...(target.detach ? ["--detach"] : []),
      worktreePath,
      ...(target.branch ? [target.branch] : []),
    ],
    { cwd: repoPath },
  );
  return worktreePath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("listGitWorktrees", () => {
  it("returns the source checkout and a branch worktree with full facts", async () => {
    const repoPath = await initRepo();
    await runGit(["branch", "feature/discovery"], { cwd: repoPath });
    const worktreePath = await addWorktree(repoPath, "feature", {
      branch: "feature/discovery",
    });

    const entries = await listGitWorktrees(repoPath);

    expect(entries).toHaveLength(2);
    const [source, feature] = entries;
    expect(source.canonicalPath).toBe(await fs.realpath(repoPath));
    expect(source.checkout).toEqual({ kind: "branch", branchName: "main" });
    expect(source.lock).toBeNull();
    expect(source.prunable).toBeNull();
    expect(feature.canonicalPath).toBe(await fs.realpath(worktreePath));
    expect(feature.checkout).toEqual({
      kind: "branch",
      branchName: "feature/discovery",
    });
  });

  it("returns a detached worktree's SHA without inventing a branch", async () => {
    const repoPath = await initRepo();
    const worktreePath = await addWorktree(repoPath, "detached", {
      detach: true,
    });
    const head = await runGit(["rev-parse", "HEAD"], { cwd: worktreePath });

    const entries = await listGitWorktrees(repoPath);
    const canonicalWorktreePath = await fs.realpath(worktreePath);
    const detached = entries.find(
      (entry) => entry.canonicalPath === canonicalWorktreePath,
    );

    expect(detached?.checkout).toEqual({
      kind: "detached",
      headSha: head.stdout.trim(),
    });
  });

  it("parses a bare source safely and keeps its linked worktrees", async () => {
    const origin = await initRepo();
    await runGit(["branch", "feature-a"], { cwd: origin });
    const root = await makeTempDir("bb-bare-layout-");
    await runGit(["clone", "--bare", origin, ".bare"], { cwd: root });
    await runGit(
      ["worktree", "add", path.join(root, "feature-a"), "feature-a"],
      {
        cwd: path.join(root, ".bare"),
      },
    );

    const entries = await listGitWorktrees(path.join(root, ".bare"));

    expect(entries).toHaveLength(2);
    expect(entries[0].checkout).toEqual({ kind: "bare" });
    expect(entries[1].checkout).toEqual({
      kind: "branch",
      branchName: "feature-a",
    });
    expect(entries[1].canonicalPath).toBe(
      await fs.realpath(path.join(root, "feature-a")),
    );
  });

  it("keeps a locked worktree available and preserves its reason", async () => {
    const repoPath = await initRepo();
    await runGit(["branch", "locked-branch"], { cwd: repoPath });
    const worktreePath = await addWorktree(repoPath, "locked", {
      branch: "locked-branch",
    });
    const reason = "kept on external drive\nwith a second line";
    await runGit(["worktree", "lock", "--reason", reason, worktreePath], {
      cwd: repoPath,
    });

    const entries = await listGitWorktrees(repoPath);
    const locked = entries.find((entry) => entry.path.endsWith("locked"));

    expect(locked?.lock).toEqual({ reason });
    expect(locked?.canonicalPath).toBe(await fs.realpath(worktreePath));
  });

  it("keeps a missing registration with a null canonical path and prunable metadata", async () => {
    const repoPath = await initRepo();
    await runGit(["branch", "stale-branch"], { cwd: repoPath });
    const worktreePath = await addWorktree(repoPath, "stale", {
      branch: "stale-branch",
    });
    await fs.rm(worktreePath, { recursive: true, force: true });

    const entries = await listGitWorktrees(repoPath);
    const stale = entries.find((entry) => entry.path.endsWith("stale"));

    expect(stale).toBeDefined();
    expect(stale?.canonicalPath).toBeNull();
    expect(stale?.prunable).not.toBeNull();
  });

  it("preserves unusual path characters", async () => {
    const repoPath = await initRepo();
    await runGit(["branch", "spaced"], { cwd: repoPath });
    const parent = await makeTempDir("bb-worktree-odd-");
    const worktreePath = path.join(parent, "wt with spaces é");
    await runGit(["worktree", "add", worktreePath, "spaced"], {
      cwd: repoPath,
    });

    const entries = await listGitWorktrees(repoPath);
    const odd = entries.find((entry) =>
      entry.path.endsWith("wt with spaces é"),
    );

    expect(odd).toBeDefined();
    expect(odd?.canonicalPath).toBe(await fs.realpath(worktreePath));
  });

  it("rejects a non-absolute source path", async () => {
    await expect(listGitWorktrees("relative/path")).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("rejects a missing source path", async () => {
    const parent = await makeTempDir("bb-worktree-missing-");
    await expect(
      listGitWorktrees(path.join(parent, "does-not-exist")),
    ).rejects.toMatchObject({ code: "path_not_found" });
  });

  it("rejects a non-repository path", async () => {
    const plainDir = await makeTempDir("bb-worktree-plain-");
    await expect(listGitWorktrees(plainDir)).rejects.toMatchObject({
      code: "not_git_repo",
    });
  });

  it("fails on a hung git process instead of waiting forever", async () => {
    const repoPath = await initRepo();
    const binDir = await makeTempDir("bb-worktree-slow-git-");
    const fakeGit = path.join(binDir, "git");
    await fs.writeFile(fakeGit, "#!/bin/sh\nexec /bin/sleep 5\n", "utf8");
    await fs.chmod(fakeGit, 0o755);

    await expect(
      listGitWorktrees(repoPath, { shellPath: binDir, timeoutMs: 200 }),
    ).rejects.toMatchObject({ code: "git_command_timeout" });
  });

  it("fails on output overflow instead of truncating", async () => {
    const repoPath = await initRepo();
    await expect(
      listGitWorktrees(repoPath, { maxBufferBytes: 8 }),
    ).rejects.toMatchObject({ code: "git_command_failed" });
  });
});

describe("parseGitWorktreeListOutput", () => {
  it("preserves NUL-delimited unusual characters in paths and reasons", () => {
    const output = [
      "worktree /repo/main",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo/wt with spaces:and colons",
      "HEAD 2222222222222222222222222222222222222222",
      "detached",
      "locked reason with\nnewline",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\0");

    const entries = parseGitWorktreeListOutput(output);

    expect(entries).toEqual([
      {
        path: "/repo/main",
        checkout: { kind: "branch", branchName: "main" },
        lock: null,
        prunable: null,
      },
      {
        path: "/repo/wt with spaces:and colons",
        checkout: {
          kind: "detached",
          headSha: "2222222222222222222222222222222222222222",
        },
        lock: { reason: "reason with\nnewline" },
        prunable: { reason: "gitdir file points to non-existent location" },
      },
    ]);
  });

  it("parses a locked marker without a reason", () => {
    const output = [
      "worktree /repo/wt",
      "HEAD 3333333333333333333333333333333333333333",
      "branch refs/heads/main",
      "locked",
      "",
    ].join("\0");

    expect(parseGitWorktreeListOutput(output)[0].lock).toEqual({
      reason: null,
    });
  });

  it("rejects a truncated record instead of returning a partial list", () => {
    const output = ["worktree /repo/main", "branch refs/heads/main"].join("\0");
    expect(() => parseGitWorktreeListOutput(output)).toThrowError(
      /ended inside a worktree record/,
    );
  });

  it("rejects a record with no checkout classification", () => {
    const output = ["worktree /repo/mystery", ""].join("\0");
    expect(() => parseGitWorktreeListOutput(output)).toThrowError(
      /no branch, detached, or bare marker/,
    );
  });
});

describe("resolveHostPaths", () => {
  it("resolves existing paths and keeps missing paths as null", async () => {
    const existing = await makeTempDir("bb-resolve-path-");
    const missing = path.join(existing, "gone");

    const resolved = await resolveHostPaths([existing, missing]);

    expect(resolved).toEqual([
      { path: existing, canonicalPath: await fs.realpath(existing) },
      { path: missing, canonicalPath: null },
    ]);
  });

  it("rejects relative comparison paths", async () => {
    await expect(resolveHostPaths(["relative"])).rejects.toMatchObject({
      code: "invalid_request",
    });
  });

  it("rejects an oversized batch", async () => {
    const paths = Array.from({ length: 201 }, (_, i) => `/tmp/p${i}`);
    await expect(resolveHostPaths(paths)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});
