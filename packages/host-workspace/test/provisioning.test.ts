import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENV_SETUP_SCRIPT_NAME } from "@bb/domain";
import { shellSingleQuote, waitForSetupMarkerCount } from "@bb/test-helpers";
import { Workspace } from "../src/workspace.js";
import {
  buildSetupScriptCommand,
  createWorktree,
  removeDirectory,
  removeWorktree,
  runSetupScript,
} from "../src/provisioning.js";
import { runGit } from "../src/git.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepoWithOptionalSetup(
  setupScript?: string,
): Promise<string> {
  const repoPath = await makeTempDir("bb-provisioning-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  if (setupScript) {
    await fs.writeFile(
      path.join(repoPath, DEFAULT_ENV_SETUP_SCRIPT_NAME),
      setupScript,
      "utf8",
    );
  }
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

async function initRemoteBackedRepo(): Promise<{
  remotePath: string;
  repoPath: string;
}> {
  const repoPath = await initRepoWithOptionalSetup();
  const remotePath = await makeTempDir("bb-provisioning-remote-");
  await runGit(["init", "--bare"], { cwd: remotePath });
  await runGit(["remote", "add", "origin", remotePath], { cwd: repoPath });
  await runGit(["push", "-u", "origin", "main"], { cwd: repoPath });
  await runGit(["fetch", "origin"], { cwd: repoPath });
  return { remotePath, repoPath };
}

async function pushRemoteMainCommit(remotePath: string): Promise<string> {
  const cloneParent = await makeTempDir("bb-provisioning-remote-clone-");
  const clonePath = path.join(cloneParent, "repo");
  await runGit(["clone", "--branch", "main", remotePath, clonePath], {
    cwd: cloneParent,
  });
  await runGit(["config", "user.name", "BB Tests"], { cwd: clonePath });
  await runGit(["config", "user.email", "bb@example.com"], {
    cwd: clonePath,
  });
  await fs.writeFile(path.join(clonePath, "remote.txt"), "remote\n", "utf8");
  await runGit(["add", "."], { cwd: clonePath });
  await runGit(["commit", "-m", "Remote edit"], { cwd: clonePath });
  const head = await runGit(["rev-parse", "HEAD"], { cwd: clonePath });
  await runGit(["push", "origin", "main"], { cwd: clonePath });
  return head.stdout.trim();
}

class AbortAtSetupListenerSignal extends EventTarget implements AbortSignal {
  onabort: ((this: AbortSignal, event: Event) => void) | null = null;
  readonly reason = new Error("test abort");
  private abortedReadCount = 0;

  get aborted(): boolean {
    this.abortedReadCount += 1;
    return this.abortedReadCount >= 3;
  }

  throwIfAborted(): void {
    if (this.aborted) {
      throw this.reason;
    }
  }
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("workspace provisioning", () => {
  it("creates worktrees and is idempotent for valid targets", async () => {
    const sourceRepo = await initRepoWithOptionalSetup();
    const parentDir = await makeTempDir("bb-worktree-parent-");
    const targetPath = path.join(parentDir, "feature");

    const first = await createWorktree({
      sourcePath: sourceRepo,
      targetPath,
      branchName: "feature",
      baseBranch: "main",
      timeoutMs: 900000,
    });
    const second = await createWorktree({
      sourcePath: sourceRepo,
      targetPath,
      branchName: "feature",
      baseBranch: "main",
      timeoutMs: 900000,
    });

    expect(first.path).toBe(targetPath);
    expect(second.path).toBe(targetPath);
    expect(await new Workspace(targetPath).currentBranch).toBe("feature");
  });

  it("fetches remote base branches before creating worktrees", async () => {
    const { remotePath, repoPath } = await initRemoteBackedRepo();
    const parentDir = await makeTempDir("bb-worktree-remote-parent-");
    const targetPath = path.join(parentDir, "feature");
    const remoteHead = await pushRemoteMainCommit(remotePath);

    const staleOriginMain = await runGit(["rev-parse", "origin/main"], {
      cwd: repoPath,
    });
    expect(staleOriginMain.stdout.trim()).not.toBe(remoteHead);

    await createWorktree({
      sourcePath: repoPath,
      targetPath,
      branchName: "feature",
      baseBranch: "origin/main",
      timeoutMs: 900000,
    });

    await expect(
      fs.readFile(path.join(targetPath, "remote.txt"), "utf8"),
    ).resolves.toBe("remote\n");
    const worktreeHead = await runGit(["rev-parse", "HEAD"], {
      cwd: targetPath,
    });
    expect(worktreeHead.stdout.trim()).toBe(remoteHead);
  });

  it("rolls back failed worktree setup scripts", async () => {
    const sourceRepo = await initRepoWithOptionalSetup(
      "echo failing >&2\nexit 1\n",
    );
    const parentDir = await makeTempDir("bb-worktree-fail-parent-");
    const targetPath = path.join(parentDir, "broken");

    await expect(
      createWorktree({
        sourcePath: sourceRepo,
        targetPath,
        branchName: "broken",
        baseBranch: "main",
        timeoutMs: 900000,
      }),
    ).rejects.toThrow(/Setup script failed/u);

    await expect(fs.stat(targetPath)).rejects.toThrow();
  });

  it("runs worktree setup scripts concurrently after creating worktrees", async () => {
    const coordinationDir = await makeTempDir("bb-worktree-setup-concurrency-");
    const markerDir = path.join(coordinationDir, "markers");
    const releaseFile = path.join(coordinationDir, "release");
    const sourceRepo = await initRepoWithOptionalSetup(
      [
        "set -euo pipefail",
        `marker_dir=${shellSingleQuote(markerDir)}`,
        `release_file=${shellSingleQuote(releaseFile)}`,
        'marker_name="$(basename "$(dirname "$PWD")")-$(basename "$PWD")"',
        'mkdir -p "$marker_dir"',
        'touch "$marker_dir/started-$marker_name"',
        'while [ ! -f "$release_file" ]; do sleep 0.05; done',
        "echo setup released",
      ].join("\n") + "\n",
    );
    const parentDir = await makeTempDir("bb-worktree-concurrent-parent-");
    const firstTargetPath = path.join(parentDir, "feature-a");
    const secondTargetPath = path.join(parentDir, "feature-b");

    const provisions = Promise.all([
      createWorktree({
        sourcePath: sourceRepo,
        targetPath: firstTargetPath,
        branchName: "feature-a",
        baseBranch: "main",
        timeoutMs: 900000,
      }),
      createWorktree({
        sourcePath: sourceRepo,
        targetPath: secondTargetPath,
        branchName: "feature-b",
        baseBranch: "main",
        timeoutMs: 900000,
      }),
    ]);
    void provisions.catch(() => undefined);

    try {
      await expect(
        waitForSetupMarkerCount({
          markerDir,
          expectedCount: 2,
          timeoutMs: 10000,
        }),
      ).resolves.toHaveLength(2);
    } finally {
      await fs.writeFile(releaseFile, "release\n", "utf8");
    }

    await expect(provisions).resolves.toEqual([
      { path: firstTargetPath },
      { path: secondTargetPath },
    ]);
  }, 15000);

  it("creates nested worktree targets when parent directories do not exist", async () => {
    const sourceRepo = await initRepoWithOptionalSetup();
    const parentDir = await makeTempDir("bb-worktree-nested-parent-");
    const targetPath = path.join(
      parentDir,
      ".bb-worktrees",
      "proj_123",
      "thr_456",
    );

    await createWorktree({
      sourcePath: sourceRepo,
      targetPath,
      branchName: "feature",
      baseBranch: "main",
      timeoutMs: 900000,
    });

    expect(await new Workspace(targetPath).currentBranch).toBe("feature");
  });

  it("passes explicit env overrides to git commands", async () => {
    const sourceRepo = await initRepoWithOptionalSetup();

    const result = await runGit(["var", "GIT_AUTHOR_IDENT"], {
      cwd: sourceRepo,
      env: {
        GIT_AUTHOR_EMAIL: "env@example.com",
        GIT_AUTHOR_NAME: "Env Author",
      },
    });

    expect(result.stdout).toContain("Env Author <env@example.com>");
  });

  it("streams setup script output and respects timeouts", async () => {
    const workspacePath = await makeTempDir("bb-setup-script-");
    await fs.writeFile(
      path.join(workspacePath, DEFAULT_ENV_SETUP_SCRIPT_NAME),
      "echo first\necho second\n",
      "utf8",
    );

    const entries: string[] = [];
    const result = await runSetupScript({
      workspacePath,
      timeoutMs: 900000,
      onProgress: (entry) => entries.push(`${entry.type}:${entry.text}`),
    });
    expect(result.ran).toBe(true);
    expect(result.output).toContain("first");
    expect(entries.some((entry) => entry.includes("first"))).toBe(true);

    await fs.writeFile(
      path.join(workspacePath, DEFAULT_ENV_SETUP_SCRIPT_NAME),
      "sleep 2\n",
      "utf8",
    );
    await expect(
      runSetupScript({
        workspacePath,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/timed out/u);
  });

  it("aborts setup scripts and emits cancellation progress", async () => {
    const workspacePath = await makeTempDir("bb-setup-abort-");
    const markerDir = await makeTempDir("bb-setup-abort-markers-");
    await fs.writeFile(
      path.join(workspacePath, DEFAULT_ENV_SETUP_SCRIPT_NAME),
      [
        "set -euo pipefail",
        `marker_dir=${shellSingleQuote(markerDir)}`,
        'trap "touch \\"$marker_dir/started-terminated\\"; exit 0" TERM',
        'touch "$marker_dir/started-setup"',
        "while true; do sleep 0.05; done",
      ].join("\n") + "\n",
      "utf8",
    );
    const abortController = new AbortController();
    const entries: string[] = [];
    const run = runSetupScript({
      workspacePath,
      timeoutMs: 900000,
      signal: abortController.signal,
      onProgress: (entry) => entries.push(`${entry.key}:${entry.text}`),
    });

    await waitForSetupMarkerCount({
      expectedCount: 1,
      markerDir,
      timeoutMs: 2_000,
    });
    abortController.abort(new Error("test abort"));

    await expect(run).rejects.toMatchObject({ code: "provision_cancelled" });
    await waitForSetupMarkerCount({
      expectedCount: 2,
      markerDir,
      timeoutMs: 2_000,
    });
    expect(entries).toContain("setup-cancelled:.bb-env-setup.sh cancelled");
  });

  it("aborts setup scripts when the signal is aborted at listener registration", async () => {
    const workspacePath = await makeTempDir("bb-setup-listener-abort-");
    const markerDir = await makeTempDir("bb-setup-listener-abort-markers-");
    const completedMarker = path.join(markerDir, "completed-setup");
    await fs.writeFile(
      path.join(workspacePath, DEFAULT_ENV_SETUP_SCRIPT_NAME),
      [
        "set -euo pipefail",
        `marker_dir=${shellSingleQuote(markerDir)}`,
        'trap "exit 0" TERM',
        "sleep 0.2",
        'touch "$marker_dir/completed-setup"',
      ].join("\n") + "\n",
      "utf8",
    );
    const entries: string[] = [];

    await expect(
      runSetupScript({
        workspacePath,
        timeoutMs: 900000,
        signal: new AbortAtSetupListenerSignal(),
        onProgress: (entry) => entries.push(`${entry.key}:${entry.text}`),
      }),
    ).rejects.toMatchObject({ code: "provision_cancelled" });

    await expect(fs.stat(completedMarker)).rejects.toThrow();
    expect(entries).toContain("setup-cancelled:.bb-env-setup.sh cancelled");
  });

  it("removes managed worktrees after setup script cancellation", async () => {
    const markerDir = await makeTempDir("bb-worktree-abort-markers-");
    const sourceRepo = await initRepoWithOptionalSetup(
      [
        "set -euo pipefail",
        `marker_dir=${shellSingleQuote(markerDir)}`,
        'trap "touch \\"$marker_dir/started-terminated\\"; exit 0" TERM',
        'touch "$marker_dir/started-setup"',
        "while true; do sleep 0.05; done",
      ].join("\n") + "\n",
    );
    const parentDir = await makeTempDir("bb-worktree-abort-parent-");
    const targetPath = path.join(parentDir, "cancelled");
    const abortController = new AbortController();
    const provision = createWorktree({
      sourcePath: sourceRepo,
      targetPath,
      branchName: "cancelled",
      baseBranch: "main",
      timeoutMs: 900000,
      signal: abortController.signal,
    });

    await waitForSetupMarkerCount({
      expectedCount: 1,
      markerDir,
      timeoutMs: 2_000,
    });
    abortController.abort(new Error("test abort"));

    await expect(provision).rejects.toMatchObject({
      code: "provision_cancelled",
    });
    await waitForSetupMarkerCount({
      expectedCount: 2,
      markerDir,
      timeoutMs: 2_000,
    });
    await expect(fs.stat(targetPath)).rejects.toThrow();
    const worktrees = await runGit(["worktree", "list", "--porcelain"], {
      cwd: sourceRepo,
    });
    expect(worktrees.stdout).not.toContain(targetPath);
  });

  it("compacts carriage-return setup script progress in transcript output", async () => {
    const workspacePath = await makeTempDir("bb-setup-progress-");
    await fs.writeFile(
      path.join(workspacePath, DEFAULT_ENV_SETUP_SCRIPT_NAME),
      "printf 'progress 1\\rprogress 2\\rprogress done\\n'\n",
      "utf8",
    );

    const outputEntries: string[] = [];
    const result = await runSetupScript({
      workspacePath,
      timeoutMs: 900000,
      onProgress: (entry) => {
        if (entry.type === "output" && entry.key.startsWith("setup-output-")) {
          outputEntries.push(entry.text);
        }
      },
    });

    expect(result.output).toBe("progress 1\rprogress 2\rprogress done\n");
    expect(outputEntries).toEqual(["progress done"]);
  });

  it("closes setup script stdin so hooks do not block on input", async () => {
    const workspacePath = await makeTempDir("bb-setup-stdin-closed-");
    await fs.writeFile(
      path.join(workspacePath, DEFAULT_ENV_SETUP_SCRIPT_NAME),
      "if read line; then echo unexpected-input; else echo stdin-closed; fi\n",
      "utf8",
    );

    const result = await runSetupScript({
      workspacePath,
      timeoutMs: 500,
    });

    expect(result.ran).toBe(true);
    expect(result.output).toContain("stdin-closed");
  });

  it("scrubs inherited bb runtime env vars before running setup scripts", async () => {
    vi.stubEnv("BB_DATA_DIR", "/tmp/leaked-bb-data");
    vi.stubEnv("BB_SERVER_PORT", "38886");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EXTERNAL_SETUP_ENV", "external-value");
    const workspacePath = await makeTempDir("bb-setup-env-");
    await fs.writeFile(
      path.join(workspacePath, DEFAULT_ENV_SETUP_SCRIPT_NAME),
      [
        'printf "%s|%s|%s|%s\\n" \\',
        '  "${BB_DATA_DIR-missing}" \\',
        '  "${BB_SERVER_PORT-missing}" \\',
        '  "${NODE_ENV-missing}" \\',
        '  "${EXTERNAL_SETUP_ENV-missing}"',
      ].join("\n"),
      "utf8",
    );

    const result = await runSetupScript({
      workspacePath,
      timeoutMs: 900000,
    });

    expect(result.ran).toBe(true);
    expect(result.output).toBe("missing|missing|missing|external-value\n");
  });

  it("builds a bash command for the supported setup script", () => {
    expect(
      buildSetupScriptCommand({
        platform: "darwin",
        scriptPath: "/tmp/.bb-env-setup.sh",
      }),
    ).toMatchObject({
      command: "env",
      args: ["bash", "/tmp/.bb-env-setup.sh"],
      text: "env bash .bb-env-setup.sh",
    });
  });

  it("rejects POSIX shell setup scripts on Windows", () => {
    expect(() =>
      buildSetupScriptCommand({
        platform: "win32",
        scriptPath: "C:\\repo\\.bb-env-setup.sh",
      }),
    ).toThrow(/not supported on Windows/u);
  });

  it("returns a no-op when the setup script is missing", async () => {
    const workspacePath = await makeTempDir("bb-setup-noop-");

    await expect(
      runSetupScript({ workspacePath, timeoutMs: 900000 }),
    ).resolves.toEqual({ ran: false });
  });

  it("removes worktrees and plain directories", async () => {
    const sourceRepo = await initRepoWithOptionalSetup();
    const parentDir = await makeTempDir("bb-remove-parent-");
    const targetPath = path.join(parentDir, "feature");

    await createWorktree({
      sourcePath: sourceRepo,
      targetPath,
      branchName: "feature",
      baseBranch: "main",
      timeoutMs: 900000,
    });
    await fs.writeFile(path.join(targetPath, "local.txt"), "dirty\n", "utf8");
    await removeWorktree({ path: targetPath, force: true });
    await expect(fs.stat(targetPath)).rejects.toThrow();
    const worktrees = await runGit(["worktree", "list", "--porcelain"], {
      cwd: sourceRepo,
    });
    expect(worktrees.stdout).not.toContain(targetPath);

    const directoryPath = await makeTempDir("bb-remove-dir-");
    await fs.writeFile(path.join(directoryPath, "file.txt"), "data\n", "utf8");
    await removeDirectory({ path: directoryPath });
    await expect(fs.stat(directoryPath)).rejects.toThrow();
  });

  it("removes orphaned worktree directories after the .git file is gone", async () => {
    const sourceRepo = await initRepoWithOptionalSetup();
    const parentDir = await makeTempDir("bb-remove-orphan-gitfile-");
    const targetPath = path.join(parentDir, "feature");

    await createWorktree({
      sourcePath: sourceRepo,
      targetPath,
      branchName: "feature-orphan-gitfile",
      baseBranch: "main",
      timeoutMs: 900000,
    });
    await fs.rm(path.join(targetPath, ".git"), { force: true });

    await removeWorktree({ path: targetPath, force: true });

    await expect(fs.stat(targetPath)).rejects.toThrow();
  });

  it("removes directories that no longer resolve as git repositories", async () => {
    const targetPath = await makeTempDir("bb-remove-non-git-dir-");
    await fs.writeFile(path.join(targetPath, "file.txt"), "data\n", "utf8");

    await removeWorktree({ path: targetPath, force: true });

    await expect(fs.stat(targetPath)).rejects.toThrow();
  });

  it("removes worktree directories when git metadata cleanup fails", async () => {
    const sourceRepo = await initRepoWithOptionalSetup();
    const parentDir = await makeTempDir("bb-remove-metadata-failure-");
    const targetPath = path.join(parentDir, "feature");

    await createWorktree({
      sourcePath: sourceRepo,
      targetPath,
      branchName: "feature-metadata-failure",
      baseBranch: "main",
      timeoutMs: 900000,
    });
    await fs.writeFile(path.join(targetPath, "local.txt"), "dirty\n", "utf8");

    await removeWorktree({ path: targetPath, force: false });

    await expect(fs.stat(targetPath)).rejects.toThrow();
  });
});
