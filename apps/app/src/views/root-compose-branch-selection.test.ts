import { describe, expect, it } from "vitest";
import { resolveSelectedBranch } from "./root-compose-branch-selection";

describe("resolveSelectedBranch", () => {
  it("hydrates remembered worktree base branches", () => {
    expect(
      resolveSelectedBranch({
        rememberedBranchName: "origin/main",
        rememberSelection: true,
        selectedBranch: null,
      }),
    ).toEqual({
      name: "origin/main",
      isNew: false,
    });
  });

  it("keeps branch remembering opt-in", () => {
    expect(
      resolveSelectedBranch({
        rememberedBranchName: "origin/main",
        rememberSelection: false,
        selectedBranch: null,
      }),
    ).toBeNull();
  });

  it("prefers the current in-memory selection", () => {
    expect(
      resolveSelectedBranch({
        rememberedBranchName: "origin/main",
        rememberSelection: true,
        selectedBranch: {
          name: "release/1.2",
          isNew: true,
        },
      }),
    ).toEqual({
      name: "release/1.2",
      isNew: true,
    });
  });
});
