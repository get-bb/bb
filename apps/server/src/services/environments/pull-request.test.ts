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
    checks: [],
    reviewDecision: null,
    reviewRequestCount: 0,
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    ...overrides,
  };
}

describe("assembleThreadPullRequest", () => {
  it("returns null when there is no PR", () => {
    expect(assembleThreadPullRequest(null)).toBeNull();
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
            },
            {
              name: "typecheck",
              status: "completed",
              conclusion: "failure",
              url: "https://github.com/acme/bb/actions/runs/1",
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
