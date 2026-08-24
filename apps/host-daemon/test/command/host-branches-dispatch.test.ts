import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchOnlineRpcCommand } from "../../src/command-dispatch.js";
import {
  cleanupTempDirs,
  createHarness,
  makeTempDir,
  runGitCommand,
} from "./dispatch-helpers.js";

afterEach(cleanupTempDirs);

async function initBranchRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-host-branches-repo-");
  await runGitCommand(["init", "-b", "develop"], { cwd: repoPath });
  await runGitCommand(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGitCommand(["config", "user.email", "bb@example.com"], {
    cwd: repoPath,
  });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGitCommand(["add", "."], { cwd: repoPath });
  await runGitCommand(["commit", "-m", "Initial commit"], { cwd: repoPath });
  await runGitCommand(["branch", "main"], { cwd: repoPath });
  await runGitCommand(["branch", "release/1.2"], { cwd: repoPath });
  return repoPath;
}

async function expectResolvesWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(new Error(`Promise did not resolve within ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function waitForFile(filePath: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`File did not appear within 2000ms: ${filePath}`);
}

describe("host.list_branches dispatch", () => {
  it("lists branches for a git repo and pins the default branch first", async () => {
    const repoPath = await initBranchRepo();
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      { type: "host.list_branches", path: repoPath, limit: 50 },
      harness.dispatchOptions(),
    );

    expect(result.checkout).toMatchObject({
      kind: "branch",
      branchName: "develop",
    });
    expect(result.defaultBranch).toBe("main");
    expect(result.hasUncommittedChanges).toBe(false);
    expect(result.operation).toEqual({ kind: "none" });
    expect(result.remoteBranches).toEqual([]);
    expect(result.selectedBranch).toBeNull();
    expect(result.branchesTruncated).toBe(false);
    expect(result.remoteBranchesTruncated).toBe(false);
    expect(result.branches[0]).toBe("main");
    expect(result.branches).toHaveLength(3);
    expect(result.branches).toEqual(
      expect.arrayContaining(["main", "develop", "release/1.2"]),
    );
  });

  it("lists remote branches separately from local checkout branches", async () => {
    const repoPath = await initBranchRepo();
    const remotePath = await makeTempDir("bb-host-branches-remote-");
    await runGitCommand(["init", "--bare"], { cwd: remotePath });
    await runGitCommand(["remote", "add", "upstream", remotePath], {
      cwd: repoPath,
    });
    await runGitCommand(["push", "upstream", "develop", "main"], {
      cwd: repoPath,
    });
    await runGitCommand(["fetch", "upstream"], { cwd: repoPath });
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      { type: "host.list_branches", path: repoPath, limit: 50 },
      harness.dispatchOptions(),
    );

    expect(result.branches).toEqual(["main", "develop", "release/1.2"]);
    expect(result.remoteBranches).toEqual([
      "upstream/develop",
      "upstream/main",
    ]);
  });

  it("pins origin default branch first in remote branch results", async () => {
    const repoPath = await initBranchRepo();
    const remotePath = await makeTempDir("bb-host-branches-origin-");
    await runGitCommand(["init", "--bare"], { cwd: remotePath });
    await runGitCommand(["remote", "add", "origin", remotePath], {
      cwd: repoPath,
    });
    await runGitCommand(["branch", "bb/aardvark"], { cwd: repoPath });
    await runGitCommand(["push", "origin", "bb/aardvark", "main"], {
      cwd: repoPath,
    });
    await runGitCommand(["fetch", "origin"], { cwd: repoPath });
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      { type: "host.list_branches", path: repoPath, limit: 1 },
      harness.dispatchOptions(),
    );

    expect(result.defaultBranch).toBe("main");
    expect(result.remoteBranches).toEqual(["origin/main"]);
    expect(result.remoteBranchesTruncated).toBe(true);
  });

  it("classifies a selected branch before filtering and pagination", async () => {
    const repoPath = await initBranchRepo();
    const remotePath = await makeTempDir("bb-host-branches-remote-");
    await runGitCommand(["init", "--bare"], { cwd: remotePath });
    await runGitCommand(["remote", "add", "upstream", remotePath], {
      cwd: repoPath,
    });
    await runGitCommand(["push", "upstream", "develop", "main"], {
      cwd: repoPath,
    });
    await runGitCommand(["fetch", "upstream"], { cwd: repoPath });
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_branches",
        path: repoPath,
        query: "release",
        selectedBranch: "upstream/main",
        limit: 1,
      },
      harness.dispatchOptions(),
    );

    expect(result.branches).toEqual(["release/1.2"]);
    expect(result.remoteBranches).toEqual([]);
    expect(result.selectedBranch).toEqual({
      name: "upstream/main",
      kind: "remote",
    });

    const missingResult = await dispatchOnlineRpcCommand(
      {
        type: "host.list_branches",
        path: repoPath,
        query: "release",
        selectedBranch: "origin/main",
        limit: 1,
      },
      harness.dispatchOptions(),
    );

    expect(missingResult.selectedBranch).toEqual({
      name: "origin/main",
      kind: "missing",
    });
  });

  it("refreshes remote branches before filtering branch lists", async () => {
    const repoPath = await initBranchRepo();
    const remotePath = await makeTempDir("bb-host-branches-fetch-remote-");
    await runGitCommand(["init", "--bare"], { cwd: remotePath });
    await runGitCommand(["remote", "add", "origin", remotePath], {
      cwd: repoPath,
    });
    await runGitCommand(["push", "origin", "main"], { cwd: repoPath });
    await runGitCommand(["fetch", "origin"], { cwd: repoPath });
    const cloneParent = await makeTempDir("bb-host-branches-fetch-clone-");
    const clonePath = path.join(cloneParent, "repo");
    await runGitCommand(["clone", remotePath, clonePath], { cwd: cloneParent });
    await runGitCommand(["config", "user.name", "BB Tests"], {
      cwd: clonePath,
    });
    await runGitCommand(["config", "user.email", "bb@example.com"], {
      cwd: clonePath,
    });
    await runGitCommand(["switch", "-c", "feature/remote-only"], {
      cwd: clonePath,
    });
    await fs.writeFile(path.join(clonePath, "remote.txt"), "remote\n", "utf8");
    await runGitCommand(["add", "."], { cwd: clonePath });
    await runGitCommand(["commit", "-m", "Remote branch"], { cwd: clonePath });
    await runGitCommand(["push", "origin", "feature/remote-only"], {
      cwd: clonePath,
    });
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_branches",
        path: repoPath,
        query: "remote-only",
        limit: 50,
      },
      harness.dispatchOptions(),
    );

    expect(result.remoteBranches).toEqual(["origin/feature/remote-only"]);
  });

  it("filters and limits branch lists", async () => {
    const repoPath = await initBranchRepo();
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_branches",
        path: repoPath,
        query: "e",
        limit: 1,
      },
      harness.dispatchOptions(),
    );

    expect(result.branches).toEqual(["develop"]);
    expect(result.branchesTruncated).toBe(true);
  });

  it("reports detached HEAD in checkout state", async () => {
    const repoPath = await initBranchRepo();
    await runGitCommand(["switch", "--detach", "HEAD"], { cwd: repoPath });
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      { type: "host.list_branches", path: repoPath, limit: 50 },
      harness.dispatchOptions(),
    );

    expect(result.checkout.kind).toBe("detached");
    expect(result.branches).toEqual(
      expect.arrayContaining(["main", "develop", "release/1.2"]),
    );
  });

  it("reports dirty primary checkouts", async () => {
    const repoPath = await initBranchRepo();
    await fs.writeFile(path.join(repoPath, "draft.txt"), "dirty\n", "utf8");
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      { type: "host.list_branches", path: repoPath, limit: 50 },
      harness.dispatchOptions(),
    );

    expect(result.hasUncommittedChanges).toBe(true);
    expect(result.operation).toEqual({ kind: "none" });
  });

  it("lists branches for a bare repository root that holds sibling worktrees", async () => {
    const origin = await initBranchRepo();
    const root = await makeTempDir("bb-host-branches-bare-root-");
    await runGitCommand(["clone", "--bare", origin, ".bare"], { cwd: root });
    await fs.writeFile(path.join(root, ".git"), "gitdir: ./.bare\n", "utf8");
    await runGitCommand(["worktree", "add", "main", "main"], { cwd: root });
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      { type: "host.list_branches", path: root, limit: 50 },
      harness.dispatchOptions(),
    );

    expect(result.checkout).toMatchObject({
      kind: "branch",
      branchName: "develop",
    });
    expect(result.defaultBranch).toBe("main");
    expect(result.branches).toEqual(
      expect.arrayContaining(["main", "develop", "release/1.2"]),
    );
    expect(result.hasUncommittedChanges).toBe(false);
    expect(result.operation).toEqual({ kind: "none" });
  });

  it("returns an empty list for non-git directories", async () => {
    const dirPath = await makeTempDir("bb-host-branches-nongit-");
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      { type: "host.list_branches", path: dirPath, limit: 50 },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({
      branches: [],
      branchesTruncated: false,
      checkout: { kind: "unknown", reason: "Path is not a git repository" },
      defaultBranch: null,
      defaultBranchRelation: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
    });
  });

  it("returns an empty list for missing paths", async () => {
    const parentPath = await makeTempDir("bb-host-branches-missing-parent-");
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_branches",
        path: path.join(parentPath, "missing"),
        limit: 50,
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({
      branches: [],
      branchesTruncated: false,
      checkout: { kind: "unknown", reason: "Path is not a git repository" },
      defaultBranch: null,
      defaultBranchRelation: null,
      hasUncommittedChanges: false,
      operation: { kind: "none" },
      originDefaultBranch: null,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: null,
    });
  });
});

describe("host.list_branch_options dispatch", () => {
  it("pins local and remote defaults before applying the page limit", async () => {
    const repoPath = await initBranchRepo();
    const remotePath = await makeTempDir("bb-host-branch-options-origin-");
    await runGitCommand(["init", "--bare"], { cwd: remotePath });
    await runGitCommand(["remote", "add", "origin", remotePath], {
      cwd: repoPath,
    });
    await runGitCommand(["branch", "bb/aardvark"], { cwd: repoPath });
    await runGitCommand(["push", "origin", "bb/aardvark", "main"], {
      cwd: repoPath,
    });
    await runGitCommand(["fetch", "origin"], { cwd: repoPath });
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_branch_options",
        path: repoPath,
        limit: 1,
        remoteRefresh: "none",
      },
      harness.dispatchOptions(),
    );

    expect(result.branches).toEqual(["main"]);
    expect(result.branchesTruncated).toBe(true);
    expect(result.remoteBranches).toEqual(["origin/main"]);
    expect(result.remoteBranchesTruncated).toBe(true);
  });

  it("returns cached refs while a remote refresh continues in the background", async () => {
    const repoPath = await initBranchRepo();
    const remotePath = await makeTempDir("bb-host-branch-options-remote-");
    await runGitCommand(["init", "--bare"], { cwd: remotePath });
    await runGitCommand(["remote", "add", "origin", remotePath], {
      cwd: repoPath,
    });
    await runGitCommand(["push", "origin", "main"], { cwd: repoPath });
    await runGitCommand(["fetch", "origin"], { cwd: repoPath });

    const cloneParent = await makeTempDir("bb-host-branch-options-clone-");
    const clonePath = path.join(cloneParent, "repo");
    await runGitCommand(["clone", remotePath, clonePath], { cwd: cloneParent });
    await runGitCommand(["config", "user.name", "BB Tests"], {
      cwd: clonePath,
    });
    await runGitCommand(["config", "user.email", "bb@example.com"], {
      cwd: clonePath,
    });
    await runGitCommand(["switch", "-c", "feature/remote-only"], {
      cwd: clonePath,
    });
    await fs.writeFile(path.join(clonePath, "remote.txt"), "remote\n", "utf8");
    await runGitCommand(["add", "."], { cwd: clonePath });
    await runGitCommand(["commit", "-m", "Remote branch"], { cwd: clonePath });
    await runGitCommand(["push", "origin", "feature/remote-only"], {
      cwd: clonePath,
    });

    const refreshStartedPath = path.join(repoPath, "refresh-started");
    const releaseRefreshPath = path.join(repoPath, "release-refresh");
    const uploadPackPath = path.join(repoPath, "delayed-upload-pack.sh");
    await fs.writeFile(
      uploadPackPath,
      `#!/bin/sh\ntouch ${JSON.stringify(refreshStartedPath)}\nwhile [ ! -f ${JSON.stringify(releaseRefreshPath)} ]; do sleep 0.01; done\nexec git-upload-pack "$@"\n`,
      { encoding: "utf8", mode: 0o755 },
    );
    await runGitCommand(
      ["config", "remote.origin.uploadpack", uploadPackPath],
      {
        cwd: repoPath,
      },
    );
    const harness = createHarness();

    const resultPromise = dispatchOnlineRpcCommand(
      {
        type: "host.list_branch_options",
        path: repoPath,
        query: "remote-only",
        selectedBranch: "origin/feature/remote-only",
        limit: 50,
        remoteRefresh: "background",
      },
      harness.dispatchOptions(),
    );

    try {
      const result = await expectResolvesWithin(resultPromise, 2_000);
      expect(result).toEqual({
        branches: [],
        branchesTruncated: false,
        remoteBranches: [],
        remoteBranchesTruncated: false,
        selectedBranch: {
          kind: "missing",
          name: "origin/feature/remote-only",
        },
      });
      await waitForFile(refreshStartedPath);
    } finally {
      await fs.writeFile(releaseRefreshPath, "release\n", "utf8");
    }

    const refreshed = await dispatchOnlineRpcCommand(
      { type: "host.list_branches", path: repoPath, limit: 50 },
      harness.dispatchOptions(),
    );
    expect(refreshed.remoteBranches).toContain("origin/feature/remote-only");
  });

  it("does not start a remote refresh when the caller opts out", async () => {
    const repoPath = await initBranchRepo();
    const harness = createHarness();

    const result = await dispatchOnlineRpcCommand(
      {
        type: "host.list_branch_options",
        path: repoPath,
        selectedBranch: "main",
        limit: 1,
        remoteRefresh: "none",
      },
      harness.dispatchOptions(),
    );

    expect(result).toEqual({
      branches: ["main"],
      branchesTruncated: true,
      remoteBranches: [],
      remoteBranchesTruncated: false,
      selectedBranch: { kind: "local", name: "main" },
    });
  });
});
