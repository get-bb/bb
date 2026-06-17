import type { ThreadPullRequest } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  PULL_REQUEST_STATE_DISPLAY,
  getPullRequestAttentionDisplay,
} from "./pull-request-display";

function pullRequest(
  overrides: Partial<ThreadPullRequest> = {},
): ThreadPullRequest {
  return {
    number: 1,
    title: "Add PR indicators",
    state: "open",
    url: "https://github.com/acme/bb/pull/1",
    baseRefName: "main",
    headRefName: "bb/pr-indicators",
    updatedAt: "2026-06-17T12:00:00Z",
    checks: {
      state: "passing",
      totalCount: 1,
      passedCount: 1,
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
    ...overrides,
  };
}

describe("pull request display icons", () => {
  it("uses GitHub pull request glyphs for PR state", () => {
    expect(PULL_REQUEST_STATE_DISPLAY.open.icon).toBe("GitPullRequestArrow");
    expect(PULL_REQUEST_STATE_DISPLAY.draft.icon).toBe("GitPullRequestDraft");
    expect(PULL_REQUEST_STATE_DISPLAY.closed.icon).toBe(
      "GitPullRequestClosed",
    );
    expect(PULL_REQUEST_STATE_DISPLAY.merged.icon).toBe("GitMerge");
  });

  it("keeps attention states PR-shaped in compact surfaces", () => {
    expect(
      getPullRequestAttentionDisplay(
        pullRequest({ attention: "checks_failed" }),
      ).icon,
    ).toBe("GitPullRequestArrow");
    expect(
      getPullRequestAttentionDisplay(
        pullRequest({ attention: "ready_to_merge" }),
      ).icon,
    ).toBe("GitPullRequestArrow");
  });
});
