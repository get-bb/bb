import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getPullRequestByUrl,
  prepareCurrentBranchRead,
  prepareUrlRead,
  readPullRequests,
} from "./git-host.js";
import { installFakeGh, makeTempDir } from "../test/fake-gh.js";

function raw(number: number) {
  return {
    number,
    title: `PR ${number}`,
    state: "OPEN",
    url: `https://github.com/acme/bb/pull/${number}`,
    isDraft: false,
    autoMergeRequest: null,
    isInMergeQueue: false,
    baseRefName: "main",
    headRefName: `pr-${number}`,
    headRefOid: "a".repeat(40),
    updatedAt: "2026-10-22T00:00:00Z",
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
                nodes: [
                  {
                    context: "build",
                    state: "SUCCESS",
                    targetUrl: null,
                    createdAt: "2026-10-22T00:00:00Z",
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      ],
    },
  };
}
afterEach(() => vi.unstubAllEnvs());

describe("host GraphQL batching", () => {
  it("shares duplicate PR loads and batches distinct PRs without mixing their checks", async () => {
    const gh = await installFakeGh({
      "api graphql": {
        resources: {
          [raw(1).url]: { data: raw(1) },
          [raw(2).url]: {
            data: {
              ...raw(2),
              isInMergeQueue: true,
              autoMergeRequest: { enabledAt: "2026-10-22T00:00:00Z" },
            },
          },
        },
      },
    });
    const cwd = await makeTempDir("bb-pr-batch-");
    const [first, duplicate, second] = await Promise.all([
      getPullRequestByUrl(raw(1).url, cwd),
      getPullRequestByUrl(raw(1).url, cwd),
      getPullRequestByUrl(raw(2).url, cwd),
    ]);
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({
      outcome: "found",
      pullRequest: {
        number: 1,
        headRefOid: "a".repeat(40),
        checks: [{ name: "build", conclusion: "success" }],
      },
    });
    expect(second).toMatchObject({
      outcome: "found",
      pullRequest: { number: 2, autoMerge: true, inMergeQueue: true },
    });
    expect(await gh.readCalls()).toHaveLength(1);
  });

  it("separates credentials and pauses only the credential that hit a rate limit", async () => {
    const gh = await installFakeGh({
      "api graphql": { stderr: "API rate limit exceeded", exit: 1 },
    });
    const cwd = await makeTempDir("bb-pr-rate-");
    vi.stubEnv("GH_TOKEN", "credential-one");
    await expect(getPullRequestByUrl(raw(1).url, cwd)).resolves.toMatchObject({
      outcome: "unavailable",
    });
    await expect(getPullRequestByUrl(raw(2).url, cwd)).resolves.toMatchObject({
      outcome: "unavailable",
      message: expect.stringContaining("rate limit"),
    });
    expect(await gh.readCalls()).toHaveLength(1);
    vi.stubEnv("GH_TOKEN", "credential-two");
    await getPullRequestByUrl(raw(1).url, cwd);
    expect(await gh.readCalls()).toHaveLength(2);
  });

  it("releases a gh profile's rate-limit pause after its active account changes", async () => {
    const gh = await installFakeGh({
      "api graphql": { stderr: "API rate limit exceeded", exit: 1 },
    });
    vi.stubEnv("GH_TOKEN", undefined);
    vi.stubEnv("GITHUB_TOKEN", undefined);
    const cwd = await makeTempDir("bb-pr-account-");
    await getPullRequestByUrl(raw(1).url, cwd);
    await getPullRequestByUrl(raw(2).url, cwd);
    expect(await gh.readCalls()).toHaveLength(1);
    await writeFile(
      join(process.env.GH_CONFIG_DIR!, "hosts.yml"),
      "github.com:\n    user: another-account\n",
    );
    await getPullRequestByUrl(raw(2).url, cwd);
    expect(await gh.readCalls()).toHaveLength(2);
  });

  it.each([
    [1, 2],
    [2, 1],
  ])(
    "keeps successful aliases when gh exits with a partial GraphQL error (%i then %i)",
    async (firstNumber, secondNumber) => {
      const gh = await installFakeGh({
        "api graphql": {
          resources: {
            [raw(1).url]: { data: raw(1) },
            [raw(2).url]: {
              data: null,
              error: "Could not resolve pull request",
            },
          },
        },
      });
      const cwd = await makeTempDir("bb-pr-partial-");
      const results = await Promise.all([
        getPullRequestByUrl(raw(firstNumber).url, cwd),
        getPullRequestByUrl(raw(secondNumber).url, cwd),
      ]);
      const first = results[firstNumber === 1 ? 0 : 1];
      const second = results[firstNumber === 2 ? 0 : 1];
      expect(first).toMatchObject({
        outcome: "found",
        pullRequest: { number: 1 },
      });
      expect(second).toMatchObject({ outcome: "unavailable" });
      expect(await gh.readCalls()).toHaveLength(1);
    },
  );

  it("reads PRs without merge-queue state from a server that lacks the field", async () => {
    const { isInMergeQueue: _, ...withoutQueue } = raw(3);
    const gh = await installFakeGh({
      "api graphql": {
        resources: {
          [raw(3).url]: { data: withoutQueue },
          [raw(4).url]: {
            data: { ...withoutQueue, number: 4, url: raw(4).url },
          },
        },
        whenQueryIncludes: {
          text: "isInMergeQueue",
          response: {
            exit: 1,
            stdout: JSON.stringify({
              errors: [
                {
                  message:
                    "Field 'isInMergeQueue' doesn't exist on type 'PullRequest'",
                },
              ],
            }),
          },
        },
      },
    });
    const cwd = await makeTempDir("bb-pr-ghes-");
    await expect(getPullRequestByUrl(raw(3).url, cwd)).resolves.toMatchObject({
      outcome: "found",
      pullRequest: { number: 3, inMergeQueue: null },
    });
    await getPullRequestByUrl(raw(4).url, cwd);
    const queries = await gh.readQueries();
    expect(queries).toHaveLength(3);
    expect(queries[2]).not.toContain("isInMergeQueue");
  });

  it("caps each document at 25 PR URLs", async () => {
    const gh = await installFakeGh({
      "api graphql": {
        resources: Object.fromEntries(
          Array.from({ length: 26 }, (_, index) => {
            const pr = raw(index + 1);
            return [pr.url, { data: pr }];
          }),
        ),
      },
    });
    const cwd = await makeTempDir("bb-pr-cap-");
    const results = await Promise.all(
      Array.from({ length: 26 }, (_, index) =>
        getPullRequestByUrl(raw(index + 1).url, cwd),
      ),
    );
    expect(results.every((result) => result.outcome === "found")).toBe(true);
    expect(results).toEqual(
      Array.from({ length: 26 }, (_, index) =>
        expect.objectContaining({
          outcome: "found",
          pullRequest: expect.objectContaining({ number: index + 1 }),
        }),
      ),
    );
    expect(await gh.readCalls()).toHaveLength(2);
  });

  it("keeps each document under GitHub's 500,000-node limit for branch lookups", async () => {
    const gh = await installFakeGh({
      "api graphql": {
        stdout: JSON.stringify({
          data: Object.fromEntries(
            Array.from({ length: 25 }, (_, index) => [
              `p${index}`,
              {
                defaultBranchRef: { name: "main" },
                pullRequests: { nodes: [] },
              },
            ]),
          ),
        }),
      },
    });
    const cwd = await makeTempDir("bb-pr-branches-");
    const git = promisify(execFile);
    await git("git", ["init", "-q"], { cwd });
    await git(
      "git",
      ["remote", "add", "origin", "https://github.com/acme/bb.git"],
      { cwd },
    );
    const results = await readPullRequests(
      Array.from({ length: 25 }, (_, index) =>
        prepareCurrentBranchRead({
          cwd,
          localBranch: `bb/branch-${index}`,
          refresh: false,
        }),
      ),
    );
    expect(results.every((result) => result.outcome === "none")).toBe(true);
    expect(await gh.readCalls()).toHaveLength(2);
  });

  it("starts reads prepared at different times together, in one document", async () => {
    const gh = await installFakeGh({
      "api graphql": {
        resources: Object.fromEntries(
          [1, 2, 3].map((number) => [raw(number).url, { data: raw(number) }]),
        ),
      },
    });
    const cwd = await makeTempDir("bb-pr-prepared-");
    const later = (delay: number, url: string) =>
      new Promise<void>((resolve) => setTimeout(resolve, delay)).then(() =>
        prepareUrlRead(url, cwd),
      );
    const results = await readPullRequests([
      prepareUrlRead(raw(1).url, cwd),
      later(30, raw(2).url),
      later(60, raw(3).url),
    ]);
    expect(results.map((result) => result.outcome)).toEqual([
      "found",
      "found",
      "found",
    ]);
    expect(await gh.readCalls()).toHaveLength(1);
  });
});
