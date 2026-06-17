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
  it("pins the selected branch before default and origin default refs", () => {
    expect(
      orderBranchPickerOptions({
        options: [
          "develop",
          "main",
          "feature/login",
          "origin/main",
          "origin/feature/login",
        ],
        priorityOptions: ["main", "origin/main"],
        selectedValue: "origin/feature/login",
      }),
    ).toEqual([
      "origin/feature/login",
      "main",
      "origin/main",
      "develop",
      "feature/login",
    ]);
  });

  it("keeps default refs near the top when no branch is selected", () => {
    expect(
      orderBranchPickerOptions({
        options: ["develop", "origin/release", "main", "origin/main"],
        priorityOptions: ["main", "origin/main"],
        selectedValue: null,
      }),
    ).toEqual(["main", "origin/main", "develop", "origin/release"]);
  });
});
