import type { GitHostPullRequest } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { assembleThreadPullRequest } from "./pull-request.js";

function rawPullRequest(
  overrides: Partial<GitHostPullRequest> = {},
): GitHostPullRequest {
  return {
    number: 42,
    title: "Add pull request section",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
    baseRefName: "main",
    headRefName: "bb/add-pr-section",
    updatedAt: "2026-06-16T12:30:00Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: [],
    reviewDecision: null,
    reviewRequestCount: 0,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  };
}

describe("assembleThreadPullRequest", () => {
  it.each([
    [
      "pending checks",
      null,
      [
        {
          name: "ci",
          status: "in_progress",
          conclusion: null,
          url: null,
          startedAt: null,
        },
      ],
      "checks_pending",
    ],
    ["required review", "REVIEW_REQUIRED", [], "review_requested"],
  ] as const)(
    "shows %s instead of generic branch protection",
    (_name, reviewDecision, checks, attention) => {
      expect(
        assembleThreadPullRequest(
          rawPullRequest({
            mergeStateStatus: "BLOCKED",
            reviewDecision,
            checks: [...checks],
          }),
        ).attention,
      ).toBe(attention);
    },
  );

  it.each([
    { name: "queued", overrides: { inMergeQueue: true }, attention: "queued" },
    {
      name: "queued with failed checks",
      overrides: {
        inMergeQueue: true,
        checks: [
          {
            name: "ci",
            status: "completed",
            conclusion: "failure",
            url: null,
            startedAt: null,
          },
        ],
      },
      attention: "checks_failed",
    },
    {
      name: "auto-merge with changes requested",
      overrides: { autoMerge: true, reviewDecision: "CHANGES_REQUESTED" },
      attention: "changes_requested",
    },
    {
      name: "queued with conflicts",
      overrides: { inMergeQueue: true, mergeable: "CONFLICTING" },
      attention: "conflicts",
    },
    {
      name: "draft with conflicts",
      overrides: { isDraft: true, mergeable: "CONFLICTING" },
      attention: "conflicts",
    },
    {
      name: "draft",
      overrides: { isDraft: true, inMergeQueue: true },
      attention: "draft",
    },
    {
      name: "merged",
      overrides: { state: "MERGED", inMergeQueue: true },
      attention: "merged",
    },
    {
      name: "closed",
      overrides: { state: "CLOSED", autoMerge: true },
      attention: "closed",
    },
    {
      name: "unknown queue",
      overrides: { inMergeQueue: null },
      attention: "blocked",
    },
  ] satisfies {
    name: string;
    overrides: Partial<GitHostPullRequest>;
    attention: string;
  }[])("keeps $name precedence", ({ overrides, attention }) => {
    expect(
      assembleThreadPullRequest(
        rawPullRequest({ mergeStateStatus: "BLOCKED", ...overrides }),
      ).attention,
    ).toBe(attention);
  });

  it("maps an open non-draft PR to 'open' and carries number/title/url", () => {
    expect(assembleThreadPullRequest(rawPullRequest())).toEqual({
      number: 42,
      title: "Add pull request section",
      url: "https://github.com/acme/bb/pull/42",
      state: "open",
      baseRefName: "main",
      headRefName: "bb/add-pr-section",
      updatedAt: "2026-06-16T12:30:00Z",
      autoMerge: false,
      inMergeQueue: false,
      checks: {
        state: "no_checks",
        totalCount: 0,
        passedCount: 0,
        failedCount: 0,
        pendingCount: 0,
      },
      review: {
        state: "none",
        reviewRequestCount: 0,
      },
      mergeability: {
        state: "mergeable",
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
      },
      attention: "none",
    });
  });

  it("folds isDraft on an open PR into 'draft'", () => {
    expect(
      assembleThreadPullRequest(rawPullRequest({ isDraft: true }))?.state,
    ).toBe("draft");
  });

  it("maps MERGED to 'merged' regardless of isDraft", () => {
    expect(
      assembleThreadPullRequest(rawPullRequest({ state: "MERGED" }))?.state,
    ).toBe("merged");
    expect(
      assembleThreadPullRequest(
        rawPullRequest({ state: "MERGED", isDraft: true }),
      )?.state,
    ).toBe("merged");
  });

  it("maps CLOSED to 'closed' regardless of isDraft", () => {
    expect(
      assembleThreadPullRequest(rawPullRequest({ state: "CLOSED" }))?.state,
    ).toBe("closed");
    expect(
      assembleThreadPullRequest(
        rawPullRequest({ state: "CLOSED", isDraft: true }),
      )?.state,
    ).toBe("closed");
  });

  it("summarizes failed checks as attention", () => {
    expect(
      assembleThreadPullRequest(
        rawPullRequest({
          checks: [
            {
              name: "test",
              status: "completed",
              conclusion: "success",
              url: null,
              startedAt: "2026-06-16T12:20:00Z",
            },
            {
              name: "typecheck",
              status: "completed",
              conclusion: "failure",
              url: "https://github.com/acme/bb/actions/runs/1",
              startedAt: "2026-06-16T12:21:00Z",
            },
          ],
        }),
      ),
    ).toMatchObject({
      checks: {
        state: "failing",
        totalCount: 2,
        passedCount: 1,
        failedCount: 1,
        pendingCount: 0,
      },
      attention: "checks_failed",
    });
  });

  it("treats unstable merge state with pending checks as checks pending", () => {
    expect(
      assembleThreadPullRequest(
        rawPullRequest({
          mergeStateStatus: "UNSTABLE",
          mergeable: "MERGEABLE",
          checks: [
            {
              name: "Checks (ubuntu-latest, Node 22.x)",
              status: "in_progress",
              conclusion: null,
              url: "https://github.com/acme/bb/actions/runs/1",
              startedAt: "2026-06-16T12:22:00Z",
            },
          ],
        }),
      ),
    ).toMatchObject({
      checks: {
        state: "pending",
        totalCount: 1,
        passedCount: 0,
        failedCount: 0,
        pendingCount: 1,
      },
      mergeability: {
        state: "mergeable",
        mergeStateStatus: "UNSTABLE",
        mergeable: "MERGEABLE",
      },
      attention: "checks_pending",
    });
  });

  it("summarizes review requests and conflicts", () => {
    expect(
      assembleThreadPullRequest(
        rawPullRequest({
          reviewDecision: "REVIEW_REQUIRED",
          reviewRequestCount: 2,
          mergeStateStatus: "DIRTY",
          mergeable: "CONFLICTING",
        }),
      ),
    ).toMatchObject({
      review: {
        state: "review_requested",
        reviewRequestCount: 2,
      },
      mergeability: {
        state: "conflicts",
        mergeStateStatus: "DIRTY",
        mergeable: "CONFLICTING",
      },
      attention: "conflicts",
    });
  });

  it("uses the latest run for each check name", () => {
    expect(
      assembleThreadPullRequest(
        rawPullRequest({
          mergeStateStatus: "BLOCKED",
          mergeable: "UNKNOWN",
          checks: [
            {
              name: "conventional title",
              status: "completed",
              conclusion: "success",
              url: "https://github.com/acme/bb/actions/runs/2",
              startedAt: "2026-06-16T12:25:00Z",
            },
            {
              name: "conventional title",
              status: "completed",
              conclusion: "cancelled",
              url: "https://github.com/acme/bb/actions/runs/1",
              startedAt: "2026-06-16T12:20:00Z",
            },
          ],
        }),
      ),
    ).toMatchObject({
      checks: {
        state: "passing",
        totalCount: 1,
        passedCount: 1,
        failedCount: 0,
        pendingCount: 0,
      },
      attention: "blocked",
    });
  });

  it("marks passing mergeable PRs as ready to merge", () => {
    expect(
      assembleThreadPullRequest(
        rawPullRequest({
          checks: [
            {
              name: "test",
              status: "completed",
              conclusion: "success",
              url: null,
              startedAt: "2026-06-16T12:20:00Z",
            },
          ],
          reviewDecision: "APPROVED",
        }),
      ),
    ).toMatchObject({
      checks: { state: "passing" },
      review: { state: "approved" },
      mergeability: { state: "mergeable" },
      attention: "ready_to_merge",
    });
  });
});
