import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostPullRequestAction } from "../contract.js";
import { installFakeGh, makeTempDir } from "../test/fake-gh.js";
import {
  getPullRequestForCurrentBranch,
  runPullRequestAction,
} from "./git-host.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const PR_URL = "https://github.com/acme/bb/pull/42";

function graphqlPr(
  overrides: Record<string, unknown> = {},
  contexts: object[] = [],
) {
  return {
    number: 42,
    title: "Add pull request section",
    state: "OPEN",
    url: PR_URL,
    isDraft: false,
    autoMergeRequest: null,
    isInMergeQueue: false,
    baseRefName: "main",
    headRefName: "bb/add-pr-section",
    headRefOid: null,
    updatedAt: "2026-06-16T12:30:00Z",
    reviewDecision: null,
    reviewRequests: { totalCount: 0 },
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: contexts,
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      ],
    },
    ...overrides,
  };
}

function graphqlResponse(pr: object) {
  return { stdout: JSON.stringify({ data: { p0: pr } }) };
}

const prView = { stdout: JSON.stringify({ url: PR_URL }) };

describe("runPullRequestAction", () => {
  it.each([
    ["ready", { operation: "ready" }, ["pr", "ready", PR_URL]],
    ["draft", { operation: "draft" }, ["pr", "ready", PR_URL, "--undo"]],
    [
      "merge",
      { operation: "merge", method: "merge" },
      ["pr", "merge", PR_URL, "--merge"],
    ],
    [
      "squash",
      { operation: "merge", method: "squash" },
      ["pr", "merge", PR_URL, "--squash"],
    ],
    [
      "rebase",
      { operation: "merge", method: "rebase" },
      ["pr", "merge", PR_URL, "--rebase"],
    ],
  ] satisfies readonly [string, HostPullRequestAction, readonly string[]][])(
    "runs gh pr %s against the checked pull request URL",
    async (_label, action, expectedArgs) => {
      const gh = await installFakeGh({});
      const cwd = await makeTempDir("bb-pr-action-");

      await expect(
        runPullRequestAction({ cwd, url: PR_URL, action }),
      ).resolves.toEqual({ ok: true });

      expect(await gh.readCalls()).toEqual([expectedArgs]);
    },
  );

  it("reports the gh failure detail", async () => {
    await installFakeGh({
      "pr merge": { stderr: "Pull request is not mergeable\n", exit: 1 },
    });

    await expect(
      runPullRequestAction({
        cwd: await makeTempDir("bb-pr-action-"),
        url: PR_URL,
        action: { operation: "merge", method: "squash" },
      }),
    ).resolves.toEqual({
      ok: false,
      message: `gh pr merge ${PR_URL} --squash failed: Pull request is not mergeable`,
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

  it("reads a draft found by gh pr view through GraphQL and ignores superseded workflow runs", async () => {
    const workflowRun = (runNumber: number) => ({
      workflowRun: {
        runNumber,
        event: "pull_request",
        workflow: { databaseId: 7 },
      },
    });
    const gh = await installFakeGh({
      "pr view": prView,
      "api graphql": graphqlResponse(
        graphqlPr({ isDraft: true }, [
          {
            name: "Tests (${{ matrix.shard }})",
            status: "COMPLETED",
            conclusion: "CANCELLED",
            detailsUrl: null,
            startedAt: "2026-06-16T12:20:00Z",
            checkSuite: workflowRun(1),
          },
          {
            name: "Tests (unit)",
            status: "COMPLETED",
            conclusion: "SUCCESS",
            detailsUrl: null,
            startedAt: "2026-06-16T12:21:00Z",
            checkSuite: workflowRun(2),
          },
        ]),
      ),
    });
    const result = await lookup();
    expect(result).toMatchObject({
      outcome: "found",
      pullRequest: { isDraft: true, inMergeQueue: false },
    });
    expect(result.outcome === "found" && result.pullRequest.checks).toEqual([
      expect.objectContaining({ name: "Tests (unit)", conclusion: "success" }),
    ]);
    expect((await gh.readCalls()).map((call) => call.slice(0, 4))).toEqual([
      ["pr", "view", "--json", "url"],
      ["api", "graphql", "--hostname", "github.com"],
    ]);
  });

  it("normalizes checks, review requests, and mergeability", async () => {
    await installFakeGh({
      "pr view": prView,
      "api graphql": graphqlResponse(
        graphqlPr(
          {
            autoMergeRequest: { enabledAt: "2026-06-16T12:00:00Z" },
            isInMergeQueue: true,
            reviewDecision: "REVIEW_REQUIRED",
            reviewRequests: { totalCount: 2 },
            mergeStateStatus: "DIRTY",
            mergeable: "CONFLICTING",
          },
          [
            {
              name: "typecheck",
              status: "COMPLETED",
              conclusion: "SUCCESS",
              detailsUrl: "https://github.com/acme/bb/actions/runs/1",
              startedAt: "2026-06-16T12:20:00Z",
            },
            {
              context: "ci/build",
              state: "FAILURE",
              targetUrl: "https://ci.example.test/build/42",
              createdAt: "2026-06-16T12:21:00Z",
            },
            {
              name: "lint",
              status: "IN_PROGRESS",
              conclusion: null,
              detailsUrl: null,
              startedAt: "2026-06-16T12:22:00Z",
            },
          ],
        ),
      ),
    });
    await expect(lookup()).resolves.toEqual({
      outcome: "found",
      pullRequest: {
        number: 42,
        title: "Add pull request section",
        state: "OPEN",
        url: PR_URL,
        isDraft: false,
        autoMerge: true,
        inMergeQueue: true,
        baseRefName: "main",
        headRefName: "bb/add-pr-section",
        headRefOid: null,
        updatedAt: "2026-06-16T12:30:00Z",
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
      },
    });
  });

  it.each([
    ["an unknown state", graphqlResponse(graphqlPr({ state: "QUEUED" }))],
    ["a non-positive number", graphqlResponse(graphqlPr({ number: 0 }))],
    ["an invalid updatedAt", graphqlResponse(graphqlPr({ updatedAt: "x" }))],
    ["a missing resource", { stdout: JSON.stringify({ data: {} }) }],
    ["non-JSON output", { stdout: "not json" }],
    ["a GraphQL failure", { stderr: "GraphQL unavailable", exit: 1 }],
  ])(
    "reports unavailable instead of a partial PR for %s",
    async (_name, graphql) => {
      await installFakeGh({ "pr view": prView, "api graphql": graphql });
      await expect(lookup()).resolves.toMatchObject({
        outcome: "unavailable",
      });
    },
  );

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

  it.each([
    ["non-JSON output", "not json at all"],
    ["a missing url", JSON.stringify({ number: 42 })],
  ])("returns unavailable when gh pr view prints %s", async (_name, stdout) => {
    await installFakeGh({ "pr view": { stdout } });
    await expect(lookup()).resolves.toEqual({
      outcome: "unavailable",
      message: "gh pr view returned unparseable output",
    });
  });
});
