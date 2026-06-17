import { describe, expect, it } from "vitest";
import { parseGitHostPullRequest } from "../src/git-host.js";

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
