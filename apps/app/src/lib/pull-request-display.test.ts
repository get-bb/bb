import type { ThreadPullRequest } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  getPullRequestAttentionDisplay,
  getPullRequestGithubStatus,
  getPullRequestStateDisplay,
} from "./pull-request-display";

function pullRequest(
  overrides: Partial<ThreadPullRequest> = {},
): ThreadPullRequest {
  return {
    number: 42,
    title: "Change",
    url: "https://github.com/acme/bb/pull/42",
    state: "open",
    baseRefName: "main",
    headRefName: "change",
    updatedAt: "2026-09-25T12:00:00Z",
    autoMerge: false,
    inMergeQueue: false,
    checks: {
      state: "passing",
      totalCount: 1,
      passedCount: 1,
      failedCount: 0,
      pendingCount: 0,
    },
    review: { state: "approved", reviewRequestCount: 0 },
    mergeability: {
      state: "blocked",
      mergeStateStatus: "BLOCKED",
      mergeable: "MERGEABLE",
    },
    attention: "blocked",
    ...overrides,
  };
}

describe("pull request signals", () => {
  it.each([
    ["blocked", "pending", "text-attention"],
    ["review_requested", "pending", "text-attention"],
    ["checks_pending", "pending", "text-attention"],
    ["queued", "pending", "text-attention"],
    ["conflicts", "failure", "text-destructive"],
    ["changes_requested", "failure", "text-destructive"],
    ["checks_failed", "failure", "text-destructive"],
    ["ready_to_merge", "success", "text-success"],
    ["none", null, "text-muted-foreground"],
  ] as const)(
    "shows %s even when the checks are green and the label is hidden",
    (attention, badge, color) => {
      const pr = pullRequest({ attention });
      expect(getPullRequestGithubStatus(pr)).toBe(badge);
      expect(getPullRequestAttentionDisplay(pr).className).toBe(color);
    },
  );

  it("shows approved auto-merge waiting without suggesting manual merge", () => {
    const pr = pullRequest({
      autoMerge: true,
      attention: "checks_pending",
      checks: {
        state: "pending",
        totalCount: 1,
        passedCount: 0,
        failedCount: 0,
        pendingCount: 1,
      },
    });
    expect(getPullRequestAttentionDisplay(pr)).toMatchObject({
      label: "Auto-merge on",
      className: "text-attention",
    });
    expect(getPullRequestStateDisplay(pr)).toMatchObject({
      icon: "GitPullRequestArrow",
      className: "text-success",
    });
    const ready = { ...pr, attention: "ready_to_merge" as const };
    expect(getPullRequestAttentionDisplay(ready).label).toBe("Auto-merge on");
    expect(getPullRequestGithubStatus(ready)).toBe("pending");
  });

  it.each(["checks_failed", "conflicts", "changes_requested"] as const)(
    "keeps %s ahead of automation labels",
    (attention) => {
      const pr = pullRequest({
        autoMerge: true,
        inMergeQueue: true,
        attention,
      });
      expect(getPullRequestAttentionDisplay(pr)).toMatchObject({
        label: {
          checks_failed: "Checks failing",
          conflicts: "Conflicts",
          changes_requested: "Changes requested",
        }[attention],
        className: "text-destructive",
      });
      expect(getPullRequestGithubStatus(pr)).toBe("failure");
    },
  );

  it.each(["merged", "closed", "draft"] as const)(
    "preserves %s lifecycle with stale auto-merge metadata",
    (state) => {
      const pr = pullRequest({
        state,
        attention: state,
        autoMerge: true,
        inMergeQueue: true,
      });
      expect(getPullRequestStateDisplay(pr).label).toBe(
        state[0]!.toUpperCase() + state.slice(1),
      );
      expect(getPullRequestGithubStatus(pr)).toBeNull();
    },
  );
});
