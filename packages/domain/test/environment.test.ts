import { describe, expect, it } from "vitest";
import {
  environmentProviderSelectionSchema,
  resolveEnvironmentMergeBaseBranch,
} from "../src/environment.js";

describe("resolveEnvironmentMergeBaseBranch", () => {
  it("prefers an explicit merge-base override", () => {
    expect(
      resolveEnvironmentMergeBaseBranch({
        baseBranch: "release",
        defaultBranch: "main",
        mergeBaseBranch: "develop",
      }),
    ).toBe("develop");
  });

  it("uses the worktree base branch before the repository default branch", () => {
    expect(
      resolveEnvironmentMergeBaseBranch({
        baseBranch: "release",
        defaultBranch: "main",
        mergeBaseBranch: null,
      }),
    ).toBe("release");
  });

  it("falls back to the repository default branch", () => {
    expect(
      resolveEnvironmentMergeBaseBranch({
        baseBranch: null,
        defaultBranch: "main",
        mergeBaseBranch: null,
      }),
    ).toBe("main");
  });
});

describe("environment provider machine selection", () => {
  it("requires an existing enrolled host in the nested machine selection", () => {
    expect(
      environmentProviderSelectionSchema.parse({
        machine: { type: "existing", hostId: "host_1" },
        inputs: null,
      }),
    ).toEqual({
      machine: { type: "existing", hostId: "host_1" },
      inputs: null,
    });
    for (const selection of [
      { machine: { type: "new", providerId: "external" }, inputs: null },
      { machine: { type: "existing", hostId: "" }, inputs: null },
      { hostId: "host_1", inputs: null },
      { inputs: null },
    ]) {
      expect(
        environmentProviderSelectionSchema.safeParse(selection).success,
      ).toBe(false);
    }
  });
});
