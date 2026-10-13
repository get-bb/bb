// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { GitDiffToolbar } from "./GitDiffToolbar";

afterEach(cleanup);

function renderToolbar(isStatsLoading: boolean) {
  return render(
    <TooltipProvider>
      <GitDiffToolbar
        selectionValue="working-tree"
        selectionOptions={[{ value: "working-tree", label: "All changes" }]}
        onSelectionChange={() => undefined}
        isSelectorDisabled={isStatsLoading}
        stats={{ filesCount: 0, insertions: 0, deletions: 0 }}
        isStatsLoading={isStatsLoading}
        totalFilesCount={0}
        isTruncated={false}
        fileFilter={null}
        onFileFilterChange={() => undefined}
        areAllFilesCollapsed={false}
        isCollapseAllDisabled
        onToggleAllCollapsed={() => undefined}
        displayMode="unified"
        onDisplayModeChange={() => undefined}
        lineOverflowMode="scroll"
        onLineOverflowModeChange={() => undefined}
      />
    </TooltipProvider>,
  );
}

it("does not report no changes while the changed files are still loading", () => {
  renderToolbar(true);

  expect(screen.queryByText("No changes")).toBeNull();
  expect(screen.getByRole("status", { name: "Loading changes" })).toBeTruthy();
});

it("reports no changes once an empty file list has loaded", () => {
  renderToolbar(false);

  expect(screen.getByText("No changes")).toBeTruthy();
  expect(screen.queryByRole("status", { name: "Loading changes" })).toBeNull();
});
