import { describe, expect, it } from "vitest";
import type { DiffFileEntry } from "@bb/server-contract";
import {
  estimateCardHeight,
  resolveDiffFileCardInitialState,
} from "./diffFilesStore";
import { GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD } from "./gitDiffPanelHelpers";

function buildEntry(overrides: Partial<DiffFileEntry> = {}): DiffFileEntry {
  return {
    path: "src/file.ts",
    previousPath: null,
    changeKind: "modified",
    additions: 0,
    deletions: 0,
    binary: false,
    origin: "tracked",
    loadMode: "auto",
    ...overrides,
  };
}

describe("resolveDiffFileCardInitialState", () => {
  it("collapses by default once the file count exceeds the threshold", () => {
    const fileCount = GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD + 1;
    expect(
      resolveDiffFileCardInitialState({ entry: buildEntry(), fileCount })
        .collapsed,
    ).toBe(true);
  });

  it("expands by default for a small diff", () => {
    expect(
      resolveDiffFileCardInitialState({
        entry: buildEntry(),
        fileCount: GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD,
      }).collapsed,
    ).toBe(false);
  });

  it("collapses deleted files by default even in a small diff", () => {
    expect(
      resolveDiffFileCardInitialState({
        entry: buildEntry({ changeKind: "deleted" }),
        fileCount: 1,
      }).collapsed,
    ).toBe(true);
  });
});

describe("estimateCardHeight", () => {
  it("returns the header floor for a zero-change entry", () => {
    const heightWithChanges = estimateCardHeight(
      buildEntry({ additions: 5, deletions: 5 }),
    );
    const heightWithoutChanges = estimateCardHeight(buildEntry());
    expect(heightWithoutChanges).toBeLessThan(heightWithChanges);
  });

  it("grows with the changed-line count", () => {
    const small = estimateCardHeight(buildEntry({ additions: 2 }));
    const larger = estimateCardHeight(buildEntry({ additions: 40 }));
    expect(larger).toBeGreaterThan(small);
  });

  it("caps the estimate for very large files", () => {
    const big = estimateCardHeight(buildEntry({ additions: 200 }));
    const huge = estimateCardHeight(buildEntry({ additions: 20_000 }));
    expect(huge).toBe(big);
  });
});
