import { describe, expect, it } from "vitest";
import { selectWorktreeBaseBranch } from "bb-environment-provider-host/base-branch";

describe("selectWorktreeBaseBranch", () => {
  it("keeps the local branch when origin is missing", () => {
    expect(
      selectWorktreeBaseBranch({
        defaultBranch: "main",
        defaultBranchRelation: null,
        originDefaultBranch: null,
      }),
    ).toBe("main");
  });

  it("uses origin when local default is equal, behind, or missing", () => {
    expect(
      selectWorktreeBaseBranch({
        defaultBranch: "main",
        defaultBranchRelation: "equal",
        originDefaultBranch: "origin/main",
      }),
    ).toBe("origin/main");

    expect(
      selectWorktreeBaseBranch({
        defaultBranch: "main",
        defaultBranchRelation: "local-behind",
        originDefaultBranch: "origin/main",
      }),
    ).toBe("origin/main");

    expect(
      selectWorktreeBaseBranch({
        defaultBranch: null,
        defaultBranchRelation: null,
        originDefaultBranch: "origin/main",
      }),
    ).toBe("origin/main");
  });

  it("keeps local when local default is ahead, diverged, or unknown", () => {
    for (const relation of ["local-ahead", "diverged", "unknown"] as const) {
      expect(
        selectWorktreeBaseBranch({
          defaultBranch: "main",
          defaultBranchRelation: relation,
          originDefaultBranch: "origin/main",
        }),
      ).toBe("main");
    }
  });
});
