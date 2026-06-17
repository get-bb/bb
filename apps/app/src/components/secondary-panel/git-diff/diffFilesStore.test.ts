import { describe, expect, it } from "vitest";
import type { DiffFileEntry } from "@bb/server-contract";
import {
  DIFF_CARD_HEADER_HEIGHT_PX,
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

  it("caps the estimate for very large files", () => {
    const big = estimateCardHeight({
      entry: buildEntry({ additions: 200 }),
      collapsed: false,
    });
    const huge = estimateCardHeight({
      entry: buildEntry({ additions: 20_000 }),
      collapsed: false,
    });
    expect(huge).toBe(big);
  });

  it("estimates the header floor for a collapsed card regardless of change count", () => {
    const entry = buildEntry({ additions: 500, deletions: 500 });
    const expanded = estimateCardHeight({ entry, collapsed: false });
    const collapsed = estimateCardHeight({ entry, collapsed: true });

    // A collapsed card renders only its header row, so a large-diff card that
    // opens collapsed must not seed the virtualizer with its full expanded body
    // height (which would overshoot the total size ~50-100x and jump the
    // scrollbar).
    expect(collapsed).toBe(DIFF_CARD_HEADER_HEIGHT_PX);
    expect(collapsed).toBeLessThan(expanded);
  });
});
