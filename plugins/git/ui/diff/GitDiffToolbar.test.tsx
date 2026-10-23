// @vitest-environment jsdom

import { DEFAULT_DIFF_FILE_FILTERS } from "./diff-file-filters.js";
import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { GitDiffToolbar } from "./GitDiffToolbar.js";

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
        extensionCounts={[]}
        onFiltersChange={() => undefined}
        filters={DEFAULT_DIFF_FILE_FILTERS}
        fileFilter={null}
        onFileFilterChange={() => undefined}
        areAllFilesCollapsed={false}
        isCollapseAllDisabled
        collapseAllDisabledReason={isStatsLoading ? null : "No changes"}
        onToggleAllCollapsed={() => undefined}
        displayMode="unified"
        onDisplayModeChange={() => undefined}
        lineOverflowMode="scroll"
        onLineOverflowModeChange={() => undefined}
        ignoreWhitespace={false}
        onIgnoreWhitespaceChange={() => undefined}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

it("keeps the disabled action name while skeletons report loading", async () => {
  const onToggleAllCollapsed = vi.fn();
  renderToolbar(true, { onToggleAllCollapsed });

  expect(screen.queryByText("No changes")).toBeNull();
  expect(screen.getByRole("status", { name: "Loading changes" })).toBeTruthy();
  const button = screen.getByRole("button", { name: "Collapse all files" });
  const trigger = screen.getByRole("group", { name: "Collapse all files" });
  expect(button.hasAttribute("disabled")).toBe(true);
  fireEvent.pointerMove(trigger, { pointerType: "mouse" });
  expect((await screen.findByRole("tooltip")).textContent).toBe(
    "Collapse all files",
  );
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(button);
  expect(onToggleAllCollapsed).not.toHaveBeenCalled();
});

it("reports no changes once an empty file list has loaded", () => {
  renderToolbar(false);

  expect(screen.getByText("No changes")).toBeTruthy();
  expect(screen.queryByRole("status", { name: "Loading changes" })).toBeNull();
});

it.each(["No changes", "No files match filter"] as const)(
  "explains %s on hover and keyboard focus without activating the disabled button",
  async (collapseAllDisabledReason) => {
    const onToggleAllCollapsed = vi.fn();
    renderToolbar(false, { collapseAllDisabledReason, onToggleAllCollapsed });
    const button = screen.getByRole("button", { name: "Collapse all files" });
    const trigger = screen.getByRole("group", {
      name: collapseAllDisabledReason,
    });

    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });

    expect((await screen.findByRole("tooltip")).textContent).toBe(
      collapseAllDisabledReason,
    );
    fireEvent.click(trigger);
    fireEvent.click(button);
    expect(onToggleAllCollapsed).not.toHaveBeenCalled();

    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  },
);

it.each([
  { areAllFilesCollapsed: false, label: "Collapse all files" },
  { areAllFilesCollapsed: true, label: "Expand all files" },
])(
  "keeps the enabled $label action and tooltip",
  async ({ areAllFilesCollapsed, label }) => {
    const onToggleAllCollapsed = vi.fn();
    renderToolbar(false, {
      areAllFilesCollapsed,
      isCollapseAllDisabled: false,
      collapseAllDisabledReason: null,
      onToggleAllCollapsed,
    });
    const button = screen.getByRole("button", { name: label });

    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.pointerMove(button, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toBe(label);
    fireEvent.click(button);
    expect(onToggleAllCollapsed).toHaveBeenCalledOnce();
  },
);
