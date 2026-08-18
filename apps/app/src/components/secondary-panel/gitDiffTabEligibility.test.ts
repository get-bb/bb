import { describe, expect, it } from "vitest";
import { resolveGitDiffTabStatus } from "./gitDiffTabEligibility";

describe("resolveGitDiffTabStatus", () => {
  it("keeps eligibility unresolved while thread or environment data loads", () => {
    expect(
      resolveGitDiffTabStatus({
        environmentId: null,
        environmentIsGitRepo: undefined,
        environmentLoadFailed: false,
        hasResolvedThread: false,
      }),
    ).toBe("loading");
    expect(
      resolveGitDiffTabStatus({
        environmentId: "env-1",
        environmentIsGitRepo: undefined,
        environmentLoadFailed: false,
        hasResolvedThread: true,
      }),
    ).toBe("loading");
  });

  it("removes Diff only after the environment is definitively ineligible", () => {
    expect(
      resolveGitDiffTabStatus({
        environmentId: null,
        environmentIsGitRepo: undefined,
        environmentLoadFailed: false,
        hasResolvedThread: true,
      }),
    ).toBe("ineligible");
    expect(
      resolveGitDiffTabStatus({
        environmentId: "env-1",
        environmentIsGitRepo: false,
        environmentLoadFailed: false,
        hasResolvedThread: true,
      }),
    ).toBe("ineligible");
  });

  it("keeps the tab present when environment eligibility cannot be loaded", () => {
    expect(
      resolveGitDiffTabStatus({
        environmentId: "env-1",
        environmentIsGitRepo: undefined,
        environmentLoadFailed: true,
        hasResolvedThread: true,
      }),
    ).toBe("error");
  });
});
