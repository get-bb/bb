import { describe, expect, it } from "vitest";
import {
  DIFF_CARD_HEADER_HEIGHT_PX,
  estimateCardHeight,
  resolveDiffFileCardInitialState,
} from "./diffFilesStore.js";
import {
  GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD,
} from "./gitDiffPanelHelpers.js";
import { makeDiffFileEntry as buildEntry } from "./diff-file-fixtures.js";

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
    const heightWithChanges = estimateCardHeight({
      entry: buildEntry({ additions: 5, deletions: 5 }),
      collapsed: false,
    });
    const heightWithoutChanges = estimateCardHeight({
      entry: buildEntry(),
      collapsed: false,
    });
    expect(heightWithoutChanges).toBeLessThan(heightWithChanges);
  });

  it("grows with the changed-line count", () => {
    const small = estimateCardHeight({
      entry: buildEntry({ additions: 2 }),
      collapsed: false,
    });
    const larger = estimateCardHeight({
      entry: buildEntry({ additions: 40 }),
      collapsed: false,
    });
    expect(larger).toBeGreaterThan(small);
  });

  it("scales with every changed line of an auto-loaded file", () => {
    const estimate = (additions: number, deletions = 0) =>
      estimateCardHeight({
        entry: buildEntry({ additions, deletions }),
        collapsed: false,
      });
    expect(estimate(300, 100) - estimate(100)).toBe(
      3 * (estimate(200) - estimate(100)),
    );
  });

  it("estimates the notice height for files that do not load automatically", () => {
    const onDemand = estimateCardHeight({
      entry: buildEntry({ additions: 600, loadMode: "on_demand" }),
      collapsed: false,
    });
    const tooLarge = estimateCardHeight({
      entry: buildEntry({ additions: 30_000, loadMode: "too_large" }),
      collapsed: false,
    });
    const small = estimateCardHeight({
      entry: buildEntry({ additions: 5 }),
      collapsed: false,
    });
    expect(tooLarge).toBe(onDemand);
    expect(onDemand).toBeLessThan(small);
  });

  it("estimates the header floor for a collapsed card regardless of change count", () => {
    const entry = buildEntry({ additions: 500, deletions: 500 });
    const expanded = estimateCardHeight({ entry, collapsed: false });
    const collapsed = estimateCardHeight({ entry, collapsed: true });

    expect(collapsed).toBe(DIFF_CARD_HEADER_HEIGHT_PX);
    expect(collapsed).toBeLessThan(expanded);
  });
});
