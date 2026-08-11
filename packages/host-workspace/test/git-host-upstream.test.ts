import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runGit } from "../src/git.js";
import { Workspace } from "../src/workspace.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

const localBranch = "bb/review-github-issue-1235-thr_test";
const forkRemote = "review-fork";
const upstreamBranch = "per-turn-permission-escalation";
const forkRemoteUrl = "git@github.com:fork-owner/bb.git";
const qualifiedUpstream = `fork-owner:${upstreamBranch}`;

function pullRequestJson(): string {
  return JSON.stringify({
    number: 1236,
    title: "Apply execution settings without replacing sessions",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/1236",
    isDraft: false,
    baseRefName: "main",
    headRefName: upstreamBranch,
    updatedAt: "2026-08-10T12:30:00Z",
    statusCheckRollup: [],
    reviewDecision: null,
    reviewRequests: [],
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  });
}

async function makeTempDir(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

async function createTrackedForkWorkspace(): Promise<string> {
  const workspacePath = await makeTempDir("bb-pr-upstream-workspace-");
  await runGit(["init", "-b", localBranch], { cwd: workspacePath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: workspacePath });
  await runGit(["config", "user.email", "bb@example.com"], {
    cwd: workspacePath,
  });
  await fs.writeFile(path.join(workspacePath, "README.md"), "test\n", "utf8");
  await runGit(["add", "README.md"], { cwd: workspacePath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: workspacePath });
  await runGit(["remote", "add", "origin", "git@github.com:acme/bb.git"], {
    cwd: workspacePath,
  });
  await runGit(["remote", "add", forkRemote, forkRemoteUrl], {
    cwd: workspacePath,
  });
  await runGit(
    ["update-ref", `refs/remotes/${forkRemote}/${upstreamBranch}`, "HEAD"],
    { cwd: workspacePath },
  );
  await runGit(
    [
      "branch",
      "--set-upstream-to",
      `${forkRemote}/${upstreamBranch}`,
      localBranch,
    ],
    { cwd: workspacePath },
  );
  return workspacePath;
}

async function installFakeGh(mode: "found" | "none" | "auth"): Promise<{
  logPath: string;
}> {
  const binPath = await makeTempDir("bb-pr-upstream-bin-");
  const logPath = path.join(binPath, "gh.log");
  const ghPath = path.join(binPath, "gh");
  await fs.writeFile(
    ghPath,
    [
      "#!/bin/sh",
      "first=1",
      'for argument in "$@"; do',
      '  if [ "$first" -eq 0 ]; then printf "\\t" >> "$TEST_GH_LOG"; fi',
      '  printf "%s" "$argument" >> "$TEST_GH_LOG"',
      "  first=0",
      "done",
      'printf "\\n" >> "$TEST_GH_LOG"',
      'if [ "$TEST_GH_MODE" = "auth" ]; then',
      '  printf "%s\\n" "gh: To get started with GitHub CLI, please run: gh auth login" >&2',
      "  exit 4",
      "fi",
      'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then',
      '  printf "%s\\n" \'{"nameWithOwner":"fork-owner/bb"}\'',
      "  exit 0",
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "view" ] && [ "$3" = "$TEST_GH_QUALIFIED_HEAD" ]; then',
      '  if [ "$TEST_GH_MODE" = "none" ]; then',
      '    printf "no pull requests found for branch \\"%s\\"\\n" "$3" >&2',
      "    exit 1",
      "  fi",
      '  printf "%s\\n" "$TEST_GH_PR_JSON"',
      "  exit 0",
      "fi",
      'printf "unexpected gh arguments: %s\\n" "$*" >&2',
      "exit 2",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.chmod(ghPath, 0o755);

  vi.stubEnv("TEST_GH_LOG", logPath);
  vi.stubEnv("TEST_GH_MODE", mode);
  vi.stubEnv("TEST_GH_QUALIFIED_HEAD", qualifiedUpstream);
  vi.stubEnv("TEST_GH_PR_JSON", pullRequestJson());
  vi.stubEnv("PATH", `${binPath}${path.delimiter}${process.env.PATH ?? ""}`);
  return { logPath };
}

async function readGhCalls(logPath: string): Promise<string[][]> {
  return (await fs.readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => line.split("\t"));
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("pull request lookup for differently named upstream branches", () => {
  it("qualifies the real tracked fork branch instead of the managed local branch", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    const { logPath } = await installFakeGh("found");

    await expect(
      new Workspace(workspacePath).getPullRequest(),
    ).resolves.toMatchObject({
      outcome: "found",
      pullRequest: {
        number: 1236,
        headRefName: upstreamBranch,
      },
    });

    const calls = await readGhCalls(logPath);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([
      "repo",
      "view",
      forkRemoteUrl,
      "--json",
      "nameWithOwner",
    ]);
    expect(calls[1]?.slice(0, 4)).toEqual([
      "pr",
      "view",
      qualifiedUpstream,
      "--json",
    ]);
  });

  it("returns none when gh genuinely finds no PR for the qualified upstream", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    await installFakeGh("none");

    await expect(
      new Workspace(workspacePath).getPullRequest(),
    ).resolves.toEqual({ outcome: "none" });
  });

  it("keeps an auth failure distinct from a genuine no-PR result", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    await installFakeGh("auth");

    await expect(
      new Workspace(workspacePath).getPullRequest(),
    ).resolves.toEqual({
      outcome: "unavailable",
      message: expect.stringContaining("gh auth login"),
    });
  });

  it("returns unavailable when gh is not installed", async () => {
    const workspacePath = await createTrackedForkWorkspace();
    const binPath = await makeTempDir("bb-pr-upstream-no-gh-");
    const { stdout } = await execFileAsync("which", ["git"], {
      encoding: "utf8",
    });
    await fs.symlink(stdout.trim(), path.join(binPath, "git"));
    vi.stubEnv("PATH", binPath);

    await expect(
      new Workspace(workspacePath).getPullRequest(),
    ).resolves.toEqual({
      outcome: "unavailable",
      message: "GitHub CLI is not available",
    });
  });
});
