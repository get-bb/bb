import { describe, expect, it } from "vitest";
import {
  buildBranchPickerOptionGroups,
  orderBranchPickerOptions,
} from "./BranchPicker";

describe("buildBranchPickerOptionGroups", () => {
  it("deduplicates exact remote refs without collapsing local and origin refs", () => {
    expect(
      buildBranchPickerOptionGroups({
        options: ["main", "develop"],
        remoteOptions: ["origin/main", "develop", "origin/develop"],
      }),
    ).toEqual({
      local: ["main", "develop"],
      remote: ["origin/main", "origin/develop"],
    });
  });
});

describe("orderBranchPickerOptions", () => {
  it("pins the selected branch before the remaining options", () => {
    expect(
      orderBranchPickerOptions({
        options: [
          "develop",
          "main",
          "feature/login",
          "origin/main",
          "origin/feature/login",
        ],
        selectedValue: "origin/feature/login",
      }),
    ).toEqual([
      "origin/feature/login",
      "develop",
      "main",
      "feature/login",
      "origin/main",
    ]);
  });
});
