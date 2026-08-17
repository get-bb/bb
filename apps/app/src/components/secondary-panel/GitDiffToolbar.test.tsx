// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitDiffToolbar } from "./GitDiffToolbar";

const LARGE_DIFF_STATS = {
  filesCount: 351,
  insertions: 38_872,
  deletions: 22_464,
};

function renderToolbar() {
  const onToggleAllCollapsed = vi.fn();
  const onDisplayModeChange = vi.fn();
  const onLineOverflowModeChange = vi.fn();

  render(
    <GitDiffToolbar
      selectionValue="all"
      selectionOptions={[{ value: "all", label: "All changes" }]}
      onSelectionChange={() => {}}
      isSelectorDisabled={false}
      stats={LARGE_DIFF_STATS}
      isTruncated={false}
      areAllFilesCollapsed={false}
      isCollapseAllDisabled={false}
      onToggleAllCollapsed={onToggleAllCollapsed}
      displayMode="unified"
      onDisplayModeChange={onDisplayModeChange}
      lineOverflowMode="scroll"
      onLineOverflowModeChange={onLineOverflowModeChange}
    />,
  );

  return {
    onToggleAllCollapsed,
    onDisplayModeChange,
    onLineOverflowModeChange,
  };
}

afterEach(() => {
  cleanup();
});

describe("GitDiffToolbar", () => {
  it("keeps large diff stats and actions together when the toolbar wraps", () => {
    const handlers = renderToolbar();

    expect(screen.getByTestId("git-diff-toolbar-layout").className).toContain(
      "flex-wrap",
    );
    expect(
      screen.getByTestId("git-diff-toolbar-selector-slot").className,
    ).toContain("basis-48");
    const details = screen.getByTestId("git-diff-toolbar-details");
    expect(details.className).toContain("min-w-max");
    expect(details.className).toContain("flex-1");
    expect(
      within(details).getByTestId("git-diff-toolbar-summary").className,
    ).toContain("shrink-0");
    expect(screen.getByTestId("git-diff-toolbar-summary").className).toContain(
      "pl-2.5",
    );
    expect(screen.getByTestId("git-diff-toolbar-summary").textContent).toBe(
      "351 files, +38,872 -22,464",
    );
    expect(
      within(details).getByTestId("git-diff-toolbar-actions").className,
    ).toContain("shrink-0");

    fireEvent.click(screen.getByRole("button", { name: "Collapse all files" }));
    fireEvent.click(screen.getByRole("button", { name: "Wrap diff lines" }));
    fireEvent.click(screen.getByRole("button", { name: "Split diff view" }));

    expect(handlers.onToggleAllCollapsed).toHaveBeenCalledOnce();
    expect(handlers.onLineOverflowModeChange).toHaveBeenCalledWith("wrap");
    expect(handlers.onDisplayModeChange).toHaveBeenCalledWith("split");
  });
});
