import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostPullRequestAction } from "../contract.js";
import { installFakeGh, makeTempDir } from "../test/fake-gh.js";
import {
  getPullRequestForCurrentBranch,
  parseGitHubPullRequestView,
  runPullRequestActionForCurrentBranch,
} from "./git-host.js";

afterEach(() => {
  vi.unstubAllEnvs();
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
    headRefOid: null,
    updatedAt: "2026-06-16T12:30:00Z",
    statusCheckRollup: [],
    reviewDecision: null,
    reviewRequests: [],
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  });
}

describe("parseGitHubPullRequestView", () => {
  it("parses a well-formed open PR", () => {
    expect(parseGitHubPullRequestView(ghJson())).toEqual({
      number: 42,
      title: "Add pull request section",
      state: "OPEN",
      url: "https://github.com/acme/bb/pull/42",
      isDraft: false,
      baseRefName: "main",
      headRefName: "bb/add-pr-section",
      headRefOid: null,
      updatedAt: "2026-06-16T12:30:00Z",
      autoMerge: false,
      inMergeQueue: null,
      checks: [],
      reviewDecision: null,
      reviewRequestCount: 0,
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    });
  });

  it("preserves the draft flag and merged/closed states", () => {
    expect(parseGitHubPullRequestView(ghJson({ isDraft: true }))?.isDraft).toBe(
      true,
    );
    expect(parseGitHubPullRequestView(ghJson({ state: "MERGED" }))?.state).toBe(
      "MERGED",
    );
    expect(parseGitHubPullRequestView(ghJson({ state: "CLOSED" }))?.state).toBe(
      "CLOSED",
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseGitHubPullRequestView(`\n  ${ghJson()}\n`)?.number).toBe(42);
  });

  it("normalizes checks, review requests, and mergeability", () => {
    expect(
      parseGitHubPullRequestView(
        ghJson({
          statusCheckRollup: [
            {
              __typename: "CheckRun",
              name: "typecheck",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              detailsUrl: "https://github.com/acme/bb/actions/runs/1",
              startedAt: "2026-06-16T12:20:00Z",
            },
            {
              __typename: "StatusContext",
              context: "ci/build",
              state: "FAILURE",
              targetUrl: "https://ci.example.test/build/42",
              createdAt: "2026-06-16T12:21:00Z",
            },
            {
              __typename: "CheckRun",
              workflowName: "lint",
              status: "IN_PROGRESS",
              conclusion: null,
              startedAt: "2026-06-16T12:22:00Z",
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
          startedAt: "2026-06-16T12:20:00Z",
        },
        {
          name: "ci/build",
          status: "completed",
          conclusion: "failure",
          url: "https://ci.example.test/build/42",
          startedAt: "2026-06-16T12:21:00Z",
        },
        {
          name: "lint",
          status: "in_progress",
          conclusion: null,
          url: null,
          startedAt: "2026-06-16T12:22:00Z",
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
    expect(parseGitHubPullRequestView(stdout)).toBeNull();
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
    expect(parseGitHubPullRequestView(stdout)).toBeNull();
  });
});

describe("runPullRequestActionForCurrentBranch", () => {
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
  ] satisfies readonly [string, HostPullRequestAction, readonly string[]][])(
    "runs gh pr %s without a target so gh can honor a fork upstream",
    async (_label, action, expectedArgs) => {
      const gh = await installFakeGh({});
      const cwd = await makeTempDir("bb-pr-action-");

      await expect(
        runPullRequestActionForCurrentBranch({
          cwd,
          localBranch: "bb/pr-action",
          action,
        }),
      ).resolves.toEqual({ ok: true });

      expect(await gh.readCalls()).toEqual([expectedArgs]);
    },
  );

  it("reports the gh failure detail", async () => {
    await installFakeGh({
      "pr merge": { stderr: "Pull request is not mergeable\n", exit: 1 },
    });

    await expect(
      runPullRequestActionForCurrentBranch({
        cwd: await makeTempDir("bb-pr-action-"),
        localBranch: "bb/pr-action",
        action: { operation: "merge", method: "squash" },
      }),
    ).resolves.toEqual({
      ok: false,
      message: "gh pr merge --squash failed: Pull request is not mergeable",
    });
  });
});

describe("getPullRequestForCurrentBranch", () => {
  async function lookup() {
    return getPullRequestForCurrentBranch({
      cwd: await makeTempDir("bb-pr-lookup-"),
      localBranch: "bb/pr-lookup",
      refresh: false,
    });
  }

  it.each([
    [
      "queued",
      {
        stdout: JSON.stringify({
          data: {
            p0: {
              ...JSON.parse(
                ghJson({ autoMergeRequest: { mergeMethod: "SQUASH" } }),
              ),
              isInMergeQueue: true,
            },
          },
        }),
      },
      true,
    ],
    [
      "not queued",
      {
        stdout: JSON.stringify({
          data: {
            p0: {
              ...JSON.parse(
                ghJson({ autoMergeRequest: { mergeMethod: "SQUASH" } }),
              ),
              isInMergeQueue: false,
            },
          },
        }),
      },
      false,
    ],
    ["invalid response", { stdout: "not json" }, null],
    [
      "missing resource",
      { stdout: JSON.stringify({ data: { resource: null } }) },
      null,
    ],
    [
      "wrong field type",
      {
        stdout: JSON.stringify({
          data: { resource: { isInMergeQueue: "true" } },
        }),
      },
      null,
    ],
    ["unavailable", { stderr: "GraphQL unavailable", exit: 1 }, null],
  ])(
    "preserves auto-merge and handles a %s queue lookup",
    async (_name, queueResponse, inMergeQueue) => {
      await installFakeGh({
        "pr view": {
          stdout: ghJson({ autoMergeRequest: { mergeMethod: "SQUASH" } }),
        },
        "api graphql": queueResponse,
      });
      await expect(lookup()).resolves.toMatchObject({
        outcome: "found",
        pullRequest: { number: 42, autoMerge: true, inMergeQueue },
      });
    },
  );

  it("skips the queue lookup for drafts", async () => {
    const gh = await installFakeGh({
      "pr view": { stdout: ghJson({ isDraft: true }) },
    });
    await expect(lookup()).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { isDraft: true, inMergeQueue: false },
    });
    expect((await gh.readCalls()).map((call) => call.slice(0, 2))).toEqual([
      ["pr", "view"],
    ]);
  });

  it("uses bare gh lookup when the branch has no differently named upstream", async () => {
    const gh = await installFakeGh({ "pr view": { stdout: ghJson() } });
    await expect(lookup()).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 42, state: "OPEN" },
    });
    expect((await gh.readCalls())[0]?.slice(0, 3)).toEqual([
      "pr",
      "view",
      "--json",
    ]);
  });

  it("returns none when gh finds no pull request", async () => {
    await installFakeGh({
      "pr view": {
        stderr: 'no pull requests found for branch "bb/pr-lookup"\n',
        exit: 1,
      },
    });
    await expect(lookup()).resolves.toEqual({ outcome: "none" });
  });

  it("returns unavailable with the stderr detail for an auth failure", async () => {
    await installFakeGh({
      "pr view": {
        stderr: "gh: To get started with GitHub CLI, please run: gh auth login",
        exit: 4,
      },
    });
    await expect(lookup()).resolves.toEqual({
      outcome: "unavailable",
      message: expect.stringContaining("gh auth login"),
    });
  });

  it("returns unavailable for unparseable gh output", async () => {
    await installFakeGh({ "pr view": { stdout: "not json at all" } });
    await expect(lookup()).resolves.toEqual({
      outcome: "unavailable",
      message: "gh pr view returned unparseable output",
    });
  });
});
