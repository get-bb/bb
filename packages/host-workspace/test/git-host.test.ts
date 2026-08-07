import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPullRequestForBranch,
  getPullRequestForCurrentBranch,
  parseGitHostPullRequest,
  runPullRequestActionForBranch,
  runPullRequestActionForCurrentBranch,
  type GitHostPullRequestAction,
} from "../src/git-host.js";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async () => {
  const actual =
    await vi.importActual<typeof import("node:child_process")>(
      "node:child_process",
    );
  const { promisify } = await import("node:util");
  // Real execFile carries a promisify custom that resolves { stdout, stderr };
  // mirror it so `promisify(execFile)` behaves the same over the mock.
  Object.defineProperty(execFileMock, promisify.custom, {
    value: (file: string, args: readonly string[], options: object) =>
      new Promise((resolve, reject) => {
        execFileMock(
          file,
          args,
          options,
          (error: Error | null, stdout = "", stderr = "") => {
            if (error) reject(error);
            else resolve({ stdout, stderr });
          },
        );
      }),
  });
  return {
    ...actual,
    execFile: execFileMock,
  };
});

beforeEach(() => {
  execFileMock.mockReset();
});

function ghJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    number: 42,
    title: "Add pull request section",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
    baseRefName: "main",
    headRefName: "bb/add-pr-section",
    updatedAt: "2026-06-16T12:30:00Z",
    statusCheckRollup: [],
    reviewDecision: null,
    reviewRequests: [],
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  });
}

describe("parseGitHostPullRequest", () => {
  it("parses a well-formed open PR", () => {
    expect(parseGitHostPullRequest(ghJson())).toEqual({
      number: 42,
      title: "Add pull request section",
      state: "OPEN",
      url: "https://github.com/acme/bb/pull/42",
      isDraft: false,
      baseRefName: "main",
      headRefName: "bb/add-pr-section",
      updatedAt: "2026-06-16T12:30:00Z",
      checks: [],
      reviewDecision: null,
      reviewRequestCount: 0,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    });
  });

  it("preserves the draft flag and merged/closed states", () => {
    expect(parseGitHostPullRequest(ghJson({ isDraft: true }))?.isDraft).toBe(
      true,
    );
    expect(parseGitHostPullRequest(ghJson({ state: "MERGED" }))?.state).toBe(
      "MERGED",
    );
    expect(parseGitHostPullRequest(ghJson({ state: "CLOSED" }))?.state).toBe(
      "CLOSED",
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseGitHostPullRequest(`\n  ${ghJson()}\n`)?.number).toBe(42);
  });

  it("normalizes checks, review requests, and mergeability", () => {
    expect(
      parseGitHostPullRequest(
        ghJson({
          statusCheckRollup: [
            {
              __typename: "CheckRun",
              name: "typecheck",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              detailsUrl: "https://github.com/acme/bb/actions/runs/1",
            },
            {
              __typename: "StatusContext",
              context: "ci/build",
              state: "FAILURE",
              targetUrl: "https://ci.example.test/build/42",
            },
            {
              __typename: "CheckRun",
              workflowName: "lint",
              status: "IN_PROGRESS",
              conclusion: null,
            },
          ],
          reviewDecision: "REVIEW_REQUIRED",
          reviewRequests: [
            { requestedReviewer: { login: "octocat" } },
            { requestedReviewer: { login: "hubot" } },
          ],
          mergeStateStatus: "DIRTY",
          mergeable: "CONFLICTING",
        }),
      ),
    ).toMatchObject({
      checks: [
        {
          name: "typecheck",
          status: "completed",
          conclusion: "success",
          url: "https://github.com/acme/bb/actions/runs/1",
        },
        {
          name: "ci/build",
          status: "completed",
          conclusion: "failure",
          url: "https://ci.example.test/build/42",
        },
        {
          name: "lint",
          status: "in_progress",
          conclusion: null,
          url: null,
        },
      ],
      reviewDecision: "REVIEW_REQUIRED",
      reviewRequestCount: 2,
      mergeStateStatus: "DIRTY",
      mergeable: "CONFLICTING",
    });
  });

  it.each([
    ["empty output", ""],
    ["whitespace only", "   \n"],
    ["non-JSON", "no pull requests found for branch"],
    ["a JSON array", "[]"],
  ])("returns null for %s", (_label, stdout) => {
    expect(parseGitHostPullRequest(stdout)).toBeNull();
  });

  it.each([
    ["an unknown state", ghJson({ state: "QUEUED" })],
    [
      "a missing field",
      JSON.stringify({ number: 1, title: "x", state: "OPEN" }),
    ],
    ["a non-positive number", ghJson({ number: 0 })],
    ["an invalid updatedAt", ghJson({ updatedAt: "yesterday" })],
    ["a non-url", ghJson({ url: "not-a-url" })],
  ])("returns null for %s", (_label, stdout) => {
    expect(parseGitHostPullRequest(stdout)).toBeNull();
  });
});

describe("runPullRequestActionForCurrentBranch", () => {
  function mockGhSuccess(): void {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "", "");
      },
    );
  }

  it.each([
    ["ready", { operation: "ready" }, ["pr", "ready"]],
    ["draft", { operation: "draft" }, ["pr", "ready", "--undo"]],
    [
      "merge",
      { operation: "merge", method: "merge" },
      ["pr", "merge", "--merge"],
    ],
    [
      "squash",
      { operation: "merge", method: "squash" },
      ["pr", "merge", "--squash"],
    ],
    [
      "rebase",
      { operation: "merge", method: "rebase" },
      ["pr", "merge", "--rebase"],
    ],
  ] satisfies readonly [string, GitHostPullRequestAction, readonly string[]][])(
    "runs gh pr %s without a target so gh can honor a fork upstream",
    async (_label, action, expectedArgs) => {
      mockGhSuccess();

      await runPullRequestActionForCurrentBranch({
        cwd: "/tmp/workspace",
        action,
      });

      expect(execFileMock).toHaveBeenCalledWith(
        "gh",
        expectedArgs,
        expect.objectContaining({
          cwd: "/tmp/workspace",
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60_000,
        }),
        expect.any(Function),
      );

      await runPullRequestActionForBranch({
        cwd: "/tmp/workspace",
        branch: "bb/pr-actions",
        action,
      });

      expect(execFileMock).toHaveBeenLastCalledWith(
        "gh",
        [...expectedArgs, "--", "bb/pr-actions"],
        expect.objectContaining({ cwd: "/tmp/workspace" }),
        expect.any(Function),
      );
    },
  );

  it("maps a missing gh executable to a workspace error", async () => {
    const error = Object.assign(new Error("spawn gh ENOENT"), {
      code: "ENOENT",
    });
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error) => void,
      ) => {
        callback(error);
      },
    );

    await expect(
      runPullRequestActionForCurrentBranch({
        cwd: "/tmp/workspace",
        action: { operation: "ready" },
      }),
    ).rejects.toMatchObject({
      code: "git_host_cli_unavailable",
      name: "WorkspaceError",
    });
  });
});

describe("getPullRequestForCurrentBranch", () => {
  function mockGhStdout(stdout: string): void {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, stdout, "");
      },
    );
  }

  function mockGhFailure(error: Error): void {
    execFileMock.mockImplementation(
      (
        _file: string,
        _args: readonly string[],
        _options: object,
        callback: (error: Error) => void,
      ) => {
        callback(error);
      },
    );
  }

  const lookupArgs = { cwd: "/tmp/workspace" };

  it("lets gh resolve the current branch through its configured upstream", async () => {
    mockGhStdout(ghJson());
    await expect(
      getPullRequestForCurrentBranch(lookupArgs),
    ).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 42, state: "OPEN" },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      ["pr", "view", "--json", expect.any(String)],
      expect.objectContaining({ cwd: "/tmp/workspace" }),
      expect.any(Function),
    );
  });

  it("preserves explicit branch lookup for existing callers", async () => {
    mockGhStdout(ghJson());
    await expect(
      getPullRequestForBranch({
        cwd: "/tmp/workspace",
        branch: "bb/pr-lookup",
      }),
    ).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 42 },
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "gh",
      [
        "pr",
        "view",
        "--json",
        expect.any(String),
        "--",
        "bb/pr-lookup",
      ],
      expect.objectContaining({ cwd: "/tmp/workspace" }),
      expect.any(Function),
    );
  });

  it("returns none when gh reports the branch has no PR", async () => {
    mockGhFailure(
      Object.assign(new Error("gh exited 1"), {
        code: 1,
        stderr: 'no pull requests found for branch "bb/pr-lookup"',
      }),
    );
    await expect(getPullRequestForCurrentBranch(lookupArgs)).resolves.toEqual({
      outcome: "none",
    });
  });

  it("returns unavailable when gh is not installed", async () => {
    mockGhFailure(
      Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
    );
    await expect(getPullRequestForCurrentBranch(lookupArgs)).resolves.toEqual({
      outcome: "unavailable",
      message: "GitHub CLI is not available",
    });
  });

  it("returns unavailable with the stderr detail for an auth failure", async () => {
    mockGhFailure(
      Object.assign(new Error("gh exited 4"), {
        code: 4,
        stderr:
          "gh: To get started with GitHub CLI, please run: gh auth login",
      }),
    );
    const result = await getPullRequestForCurrentBranch(lookupArgs);
    expect(result.outcome).toBe("unavailable");
    expect(result).toMatchObject({
      message: expect.stringContaining("gh auth login"),
    });
  });

  it("returns unavailable when gh times out", async () => {
    mockGhFailure(
      Object.assign(new Error("timed out"), { killed: true, code: null }),
    );
    await expect(
      getPullRequestForCurrentBranch(lookupArgs),
    ).resolves.toMatchObject({
      outcome: "unavailable",
      message: expect.stringContaining("timed out"),
    });
  });

  it("returns unavailable for unparseable gh output", async () => {
    mockGhStdout("not json at all");
    await expect(getPullRequestForCurrentBranch(lookupArgs)).resolves.toEqual({
      outcome: "unavailable",
      message: "gh pr view returned unparseable output",
    });
  });
});
