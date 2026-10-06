import type { ThreadPullRequest } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  getPullRequestAttentionDisplay,
  getPullRequestGithubCheckStatus,
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
    ["blocked", "success", "text-attention"],
    ["review_requested", "success", "text-attention"],
    ["checks_pending", "success", "text-attention"],
    ["queued", "success", "text-attention"],
    ["conflicts", "success", "text-destructive"],
    ["changes_requested", "success", "text-destructive"],
    ["checks_failed", "success", "text-destructive"],
    ["ready_to_merge", "success", "text-success"],
    ["none", "success", "text-muted-foreground"],
  ] as const)(
    "keeps passing checks separate from %s attention",
    (attention, badge, color) => {
      const pr = pullRequest({ attention });
      expect(getPullRequestGithubCheckStatus(pr)).toBe(badge);
      expect(getPullRequestAttentionDisplay(pr).className).toBe(color);
    },
  );

  it.each([
    ["passing", "success"],
    ["failing", "failure"],
    ["pending", "pending"],
    ["no_checks", null],
    ["unknown", null],
  ] as const)(
    "uses checks %s for the favicon despite merge automation",
    (state, status) => {
      const pr = pullRequest({
        autoMerge: true,
        inMergeQueue: true,
        attention: "queued",
      });
      pr.checks.state = state;
      expect(getPullRequestGithubCheckStatus(pr)).toBe(status);
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
    expect(getPullRequestGithubCheckStatus(ready)).toBe("pending");
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
      expect(getPullRequestGithubCheckStatus(pr)).toBe("success");
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
      expect(getPullRequestGithubCheckStatus(pr)).toBe(
        state === "draft" ? "success" : null,
      );
    },
  );
});
