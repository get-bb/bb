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
});
