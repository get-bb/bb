import { describe, expect, it } from "vitest";
import { resolveDefaultWorktreeBaseBranch } from "../../src/services/projects/worktree-base-branch.js";

describe("resolveDefaultWorktreeBaseBranch", () => {
  it("keeps the local branch when origin is missing", () => {
    expect(
      resolveDefaultWorktreeBaseBranch({
        defaultBranch: "main",
        originDefaultBranch: null,
      }),
    ).toBe("main");
  });

  it("uses origin when the local default is missing", () => {
    expect(
      resolveDefaultWorktreeBaseBranch({
        defaultBranch: null,
        originDefaultBranch: "origin/main",
      }),
    ).toBe("origin/main");
  });

  it("uses origin regardless of the local default branch relation", () => {
    for (const relation of [
      "equal",
      "local-behind",
      "local-ahead",
      "diverged",
      "unknown",
      null,
    ] as const) {
      const checkout = {
        defaultBranch: "main",
        defaultBranchRelation: relation,
        originDefaultBranch: "origin/main",
      };
      expect(resolveDefaultWorktreeBaseBranch(checkout)).toBe("origin/main");
    }
  });
});
