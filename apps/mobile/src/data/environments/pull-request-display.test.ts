import type { ThreadPullRequest } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  formatPullRequestRowLabel,
  getEnvironmentPullRequestFromResponse,
  getEnvironmentPullRequestRefetchInterval,
  getEnvironmentPullRequestStaleTime,
  getPullRequestAttentionDisplay,
  getPullRequestGithubCheckStatus,
  resolvePullRequestBannerAction,
  shouldShowPullRequestAttentionLabel,
} from "./pull-request-display";

export function pullRequest(
  overrides: Partial<ThreadPullRequest> = {},
): ThreadPullRequest {
  return {
    number: 12,
    title: "Add banner",
    state: "open",
    url: "https://github.com/acme/bb/pull/12",
    baseRefName: "main",
    headRefName: "feature",
    updatedAt: "2026-08-18T00:00:00.000Z",
    checks: {
      state: "passing",
      totalCount: 2,
      passedCount: 2,
      failedCount: 0,
      pendingCount: 0,
    },
    review: { state: "approved", reviewRequestCount: 0 },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: null,
      mergeable: null,
    },
    attention: "ready_to_merge",
    ...overrides,
  };
}

describe("pull request display", () => {
  it("labels the row with the number and a non-open state", () => {
    expect(formatPullRequestRowLabel(pullRequest())).toBe("PR #12");
    expect(formatPullRequestRowLabel(pullRequest({ state: "merged" }))).toBe(
      "PR #12 · Merged",
    );
  });

  it("shows an attention suffix only for actionable attention states", () => {
    expect(shouldShowPullRequestAttentionLabel(pullRequest())).toBe(false);
    const failing = pullRequest({ attention: "checks_failed" });
    expect(shouldShowPullRequestAttentionLabel(failing)).toBe(true);
    expect(getPullRequestAttentionDisplay(failing)).toMatchObject({
      label: "Checks failing",
      tone: "destructive",
      icon: "GitPullRequestArrow",
    });
  });

  it("carries a checks glyph only for live pull requests whose checks ran", () => {
    expect(getPullRequestGithubCheckStatus(pullRequest())).toBe("success");
    expect(
      getPullRequestGithubCheckStatus(
        pullRequest({
          state: "draft",
          checks: {
            state: "pending",
            totalCount: 1,
            passedCount: 0,
            failedCount: 0,
            pendingCount: 1,
          },
        }),
      ),
    ).toBe("pending");
    expect(
      getPullRequestGithubCheckStatus(pullRequest({ state: "merged" })),
    ).toBeNull();
    expect(
      getPullRequestGithubCheckStatus(
        pullRequest({
          checks: {
            state: "no_checks",
            totalCount: 0,
            passedCount: 0,
            failedCount: 0,
            pendingCount: 0,
          },
        }),
      ),
    ).toBeNull();
  });

  it("offers Mark ready for drafts, Merge for mergeable open PRs, nothing otherwise", () => {
    expect(
      resolvePullRequestBannerAction(pullRequest({ state: "draft" })),
    ).toEqual({ kind: "mark-ready" });
    expect(resolvePullRequestBannerAction(pullRequest())).toEqual({
      kind: "merge",
    });
    expect(
      resolvePullRequestBannerAction(
        pullRequest({
          mergeability: {
            state: "conflicts",
            mergeStateStatus: null,
            mergeable: null,
          },
        }),
      ),
    ).toEqual({ kind: "none" });
    expect(
      resolvePullRequestBannerAction(pullRequest({ state: "closed" })),
    ).toEqual({ kind: "none" });
  });

  it("polls open PRs with pending checks / unknown mergeability and settles merged ones for an hour", () => {
    const pending = pullRequest({
      checks: {
        state: "pending",
        totalCount: 1,
        passedCount: 0,
        failedCount: 0,
        pendingCount: 1,
      },
    });
    expect(getEnvironmentPullRequestRefetchInterval(pending)).toBe(5_000);
    expect(getEnvironmentPullRequestRefetchInterval(pullRequest())).toBe(false);
    expect(
      getEnvironmentPullRequestRefetchInterval(
        pullRequest({ state: "draft", attention: "draft" }),
      ),
    ).toBe(false);
    expect(getEnvironmentPullRequestRefetchInterval(null)).toBe(false);
    expect(
      getEnvironmentPullRequestStaleTime(pullRequest({ state: "merged" })),
    ).toBe(60 * 60_000);
    expect(getEnvironmentPullRequestStaleTime(pullRequest())).toBe(30_000);
    expect(getEnvironmentPullRequestStaleTime(null)).toBe(30_000);
  });

  it("treats absent and unavailable lookups as no pull request", () => {
    const pr = pullRequest();
    expect(
      getEnvironmentPullRequestFromResponse({
        outcome: "available",
        pullRequest: pr,
      }),
    ).toBe(pr);
    expect(
      getEnvironmentPullRequestFromResponse({ outcome: "absent" }),
    ).toBeNull();
    expect(
      getEnvironmentPullRequestFromResponse({
        outcome: "unavailable",
        message: "gh not installed",
      }),
    ).toBeNull();
    expect(getEnvironmentPullRequestFromResponse(undefined)).toBeNull();
  });
});
