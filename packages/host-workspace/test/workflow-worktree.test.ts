import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENV_SETUP_SCRIPT_NAME } from "@bb/domain";
import { Workspace } from "../src/workspace.js";
import { revParse, runGit } from "../src/git.js";
import {
  provisionWorkflowWorktree,
  teardownWorkflowWorktree,
} from "../src/workflow-worktree.js";

const SETUP_TIMEOUT_MS = 900_000;

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(files?: Record<string, string>): Promise<string> {
  const repoPath = await makeTempDir("bb-workflow-worktree-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  for (const [filePath, contents] of Object.entries(files ?? {})) {
    await fs.writeFile(path.join(repoPath, filePath), contents, "utf8");
  }
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

async function commitFile(args: {
  cwd: string;
  fileName: string;
  message: string;
}): Promise<void> {
  await fs.writeFile(path.join(args.cwd, args.fileName), "content\n", "utf8");
  await runGit(["add", "."], { cwd: args.cwd });
  await runGit(["commit", "-m", args.message], { cwd: args.cwd });
}

async function readRecordedBase(worktreePath: string): Promise<string> {
  const result = await runGit(
    ["config", "--worktree", "--get", "bb.workflowWorktreeBase"],
    { cwd: worktreePath },
  );
  return result.stdout.trim();
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const result = await runGit(["branch", "--list", branch], { cwd: repoPath });
  return result.stdout.trim().length > 0;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("workflow worktrees", () => {
  it("provisions wf/<runId>-<index> branches and records per-worktree bases", async () => {
    const sourceRepo = await initRepo();
    const parentDir = await makeTempDir("bb-workflow-worktree-parent-");
    const firstBase = await revParse(sourceRepo, "HEAD");

    const first = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "0"),
      runId: "wfr_test",
      agentIndex: 0,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });

    expect(first).toEqual({
      path: path.join(parentDir, "0"),
      branch: "wf/wfr_test-0",
    });
    expect(await new Workspace(first.path).currentBranch).toBe("wf/wfr_test-0");
    expect(await readRecordedBase(first.path)).toBe(firstBase);

    // Advance the source so the second worktree has a different base, then
    // assert the records stay per-worktree (the shared config would clobber).
    await commitFile({
      cwd: sourceRepo,
      fileName: "advance.txt",
      message: "Advance main",
    });
    const secondBase = await revParse(sourceRepo, "HEAD");

    const second = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "1"),
      runId: "wfr_test",
      agentIndex: 1,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });

    expect(second.branch).toBe("wf/wfr_test-1");
    expect(secondBase).not.toBe(firstBase);
    expect(await readRecordedBase(second.path)).toBe(secondBase);
    expect(await readRecordedBase(first.path)).toBe(firstBase);
  });

  it("removes clean worktrees and deletes their branch", async () => {
    const sourceRepo = await initRepo();
    const parentDir = await makeTempDir("bb-workflow-worktree-parent-");
    const worktree = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "0"),
      runId: "wfr_clean",
      agentIndex: 0,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });

    const result = await teardownWorkflowWorktree({
      sourcePath: sourceRepo,
      worktree,
    });

    expect(result).toEqual({ removed: true });
    await expect(fs.stat(worktree.path)).rejects.toThrow();
    expect(await branchExists(sourceRepo, worktree.branch)).toBe(false);
    const worktrees = await runGit(["worktree", "list", "--porcelain"], {
      cwd: sourceRepo,
    });
    expect(worktrees.stdout).not.toContain(worktree.path);
  });

  it("runs the setup script and treats its gitignored artifacts as clean", async () => {
    const sourceRepo = await initRepo({
      ".gitignore": "setup-marker.txt\n",
      [DEFAULT_ENV_SETUP_SCRIPT_NAME]: "touch setup-marker.txt\n",
    });
    const parentDir = await makeTempDir("bb-workflow-worktree-parent-");

    const worktree = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "0"),
      runId: "wfr_setup",
      agentIndex: 0,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });

    await expect(
      fs.stat(path.join(worktree.path, "setup-marker.txt")),
    ).resolves.toBeDefined();

    const result = await teardownWorkflowWorktree({
      sourcePath: sourceRepo,
      worktree,
    });
    expect(result).toEqual({ removed: true });
  });

  it("preserves worktrees with uncommitted changes", async () => {
    const sourceRepo = await initRepo();
    const parentDir = await makeTempDir("bb-workflow-worktree-parent-");
    const worktree = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "0"),
      runId: "wfr_dirty",
      agentIndex: 0,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });
    await fs.writeFile(
      path.join(worktree.path, "untracked.txt"),
      "work\n",
      "utf8",
    );

    const result = await teardownWorkflowWorktree({
      sourcePath: sourceRepo,
      worktree,
    });

    expect(result).toEqual({
      removed: false,
      preservedBranch: worktree.branch,
    });
    await expect(fs.stat(worktree.path)).resolves.toBeDefined();
    expect(await branchExists(sourceRepo, worktree.branch)).toBe(true);
  });

  it("preserves committed work even after the source branch advances", async () => {
    const sourceRepo = await initRepo();
    const parentDir = await makeTempDir("bb-workflow-worktree-parent-");
    const worktree = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "0"),
      runId: "wfr_committed",
      agentIndex: 0,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });
    await commitFile({
      cwd: worktree.path,
      fileName: "agent-work.txt",
      message: "Agent work",
    });
    // If teardown compared against the source HEAD instead of the recorded
    // creation base, advancing main would make the agent's commit look
    // zero-ahead and get force-deleted.
    await commitFile({
      cwd: sourceRepo,
      fileName: "main-advance.txt",
      message: "Advance main",
    });

    const result = await teardownWorkflowWorktree({
      sourcePath: sourceRepo,
      worktree,
    });

    expect(result).toEqual({
      removed: false,
      preservedBranch: worktree.branch,
    });
    expect(await branchExists(sourceRepo, worktree.branch)).toBe(true);
  });

  it("preserves on doubt when the recorded base is missing or unusable", async () => {
    const sourceRepo = await initRepo();
    const parentDir = await makeTempDir("bb-workflow-worktree-parent-");

    const missingBase = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "0"),
      runId: "wfr_doubt",
      agentIndex: 0,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });
    await runGit(["config", "--worktree", "--unset", "bb.workflowWorktreeBase"], {
      cwd: missingBase.path,
    });
    await expect(
      teardownWorkflowWorktree({ sourcePath: sourceRepo, worktree: missingBase }),
    ).resolves.toEqual({
      removed: false,
      preservedBranch: missingBase.branch,
    });
    await expect(fs.stat(missingBase.path)).resolves.toBeDefined();

    const garbageBase = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "1"),
      runId: "wfr_doubt",
      agentIndex: 1,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });
    await runGit(
      ["config", "--worktree", "bb.workflowWorktreeBase", "not-a-commit"],
      { cwd: garbageBase.path },
    );
    await expect(
      teardownWorkflowWorktree({ sourcePath: sourceRepo, worktree: garbageBase }),
    ).resolves.toEqual({
      removed: false,
      preservedBranch: garbageBase.branch,
    });

    const missingDir = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "2"),
      runId: "wfr_doubt",
      agentIndex: 2,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });
    await fs.rm(missingDir.path, { recursive: true, force: true });
    await expect(
      teardownWorkflowWorktree({ sourcePath: sourceRepo, worktree: missingDir }),
    ).resolves.toEqual({
      removed: false,
      preservedBranch: missingDir.branch,
    });
  });

  it("a retry provisions a -r<attempt> branch even when the prior attempt's branch was preserved", async () => {
    const sourceRepo = await initRepo();
    const parentDir = await makeTempDir("bb-workflow-worktree-parent-");
    const first = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "0"),
      runId: "wfr_retry",
      agentIndex: 0,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });
    // The failed attempt left dirty work: teardown preserves its branch.
    await fs.writeFile(path.join(first.path, "wip.txt"), "work\n", "utf8");
    await expect(
      teardownWorkflowWorktree({ sourcePath: sourceRepo, worktree: first }),
    ).resolves.toEqual({ removed: false, preservedBranch: "wf/wfr_retry-0" });

    // The retry must not collide with the preserved branch (or destroy its
    // preserved directory): it gets its own attempt-suffixed branch and path.
    const second = await provisionWorkflowWorktree({
      sourcePath: sourceRepo,
      targetPath: path.join(parentDir, "0-r1"),
      runId: "wfr_retry",
      agentIndex: 0,
      attempt: 1,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    });
    expect(second.branch).toBe("wf/wfr_retry-0-r1");
    expect(await new Workspace(second.path).currentBranch).toBe(
      "wf/wfr_retry-0-r1",
    );
    await expect(
      fs.stat(path.join(first.path, "wip.txt")),
    ).resolves.toBeDefined();
    expect(await branchExists(sourceRepo, "wf/wfr_retry-0")).toBe(true);
  });

  it("replaces stale leftovers from a crashed prior attempt", async () => {
    const sourceRepo = await initRepo();
    const parentDir = await makeTempDir("bb-workflow-worktree-parent-");
    const targetPath = path.join(parentDir, "0");
    const provisionArgs = {
      sourcePath: sourceRepo,
      targetPath,
      runId: "wfr_resume",
      agentIndex: 0,
      attempt: 0,
      setupTimeoutMs: SETUP_TIMEOUT_MS,
    };

    // Crashed attempt left a dirty worktree behind: re-provision starts fresh.
    const first = await provisionWorkflowWorktree(provisionArgs);
    await commitFile({
      cwd: first.path,
      fileName: "stale-work.txt",
      message: "Stale attempt work",
    });
    await commitFile({
      cwd: sourceRepo,
      fileName: "main-advance.txt",
      message: "Advance main",
    });
    const advancedBase = await revParse(sourceRepo, "HEAD");

    const second = await provisionWorkflowWorktree(provisionArgs);
    expect(second.branch).toBe(first.branch);
    await expect(
      fs.stat(path.join(second.path, "stale-work.txt")),
    ).rejects.toThrow();
    expect(await revParse(second.path, "HEAD")).toBe(advancedBase);
    expect(await readRecordedBase(second.path)).toBe(advancedBase);

    // Crashed attempt whose directory vanished leaves a stale registration
    // that pins the path and branch; provisioning must prune and succeed.
    await fs.rm(targetPath, { recursive: true, force: true });
    const third = await provisionWorkflowWorktree(provisionArgs);
    expect(await new Workspace(third.path).currentBranch).toBe(
      "wf/wfr_resume-0",
    );
  });
});
