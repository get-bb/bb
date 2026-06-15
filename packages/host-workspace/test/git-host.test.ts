import { describe, expect, it } from "vitest";
import { parseGitHostPullRequest } from "../src/git-host.js";

function ghJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    number: 42,
    title: "Add pull request section",
    state: "OPEN",
    url: "https://github.com/acme/bb/pull/42",
    isDraft: false,
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
    ["a missing field", JSON.stringify({ number: 1, title: "x", state: "OPEN" })],
    ["a non-positive number", ghJson({ number: 0 })],
    ["an extra field", ghJson({ mergeable: "MERGEABLE" })],
    ["a non-url", ghJson({ url: "not-a-url" })],
  ])("returns null for %s", (_label, stdout) => {
    expect(parseGitHostPullRequest(stdout)).toBeNull();
  });
});
