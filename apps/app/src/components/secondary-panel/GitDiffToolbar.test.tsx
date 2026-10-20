// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { GitDiffToolbar } from "./GitDiffToolbar";

afterEach(cleanup);

function renderToolbar(
  isStatsLoading: boolean,
  overrides: Partial<ComponentProps<typeof GitDiffToolbar>> = {},
) {
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
        {...overrides}
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

it.each([
  { areAllFilesCollapsed: false, label: "Collapse all files" },
  { areAllFilesCollapsed: true, label: "Expand all files" },
])(
  "shows $label on hover while disabled without activating it",
  async ({ areAllFilesCollapsed, label }) => {
    const onToggleAllCollapsed = vi.fn();
    renderToolbar(false, { areAllFilesCollapsed, onToggleAllCollapsed });
    const button = screen.getByRole("button", { name: label });
    const trigger = button.parentElement!;

    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });

    expect((await screen.findByRole("tooltip")).textContent).toBe(label);
    fireEvent.click(trigger);
    fireEvent.click(button);
    expect(onToggleAllCollapsed).not.toHaveBeenCalled();

    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  },
);
