import { describe, expect, it } from "vitest";
import { getDiffSizeBarBlocks } from "./diff-stats-tally";

describe("getDiffSizeBarBlocks", () => {
  it("leaves the bar empty when nothing changed", () => {
    expect(getDiffSizeBarBlocks({ insertions: 0, deletions: 0 })).toEqual({
      added: 0,
      removed: 0,
    });
  });

  it("fills one block for a one-line change", () => {
    expect(getDiffSizeBarBlocks({ insertions: 1, deletions: 0 })).toEqual({
      added: 1,
      removed: 0,
    });
  });

  it("caps large changes at five blocks split by share", () => {
    expect(getDiffSizeBarBlocks({ insertions: 129, deletions: 107 })).toEqual({
      added: 3,
      removed: 2,
    });
  });
});
