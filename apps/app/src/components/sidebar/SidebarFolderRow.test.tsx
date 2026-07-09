// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@/lib/thread-activity";
import { SidebarFolderRow } from "./SidebarFolderRow";

function activity(
  overrides: Partial<CollapsedChildActivity> = {},
): CollapsedChildActivity {
  return { ...NO_COLLAPSED_CHILD_ACTIVITY, ...overrides };
}

afterEach(cleanup);

describe("SidebarFolderRow", () => {
  it("right-aligns collapsed activity in the trailing action area", () => {
    render(
      <TooltipProvider>
        <SidebarFolderRow
          name="Build"
          label="Build"
          depth={0}
          activity={activity({ backgroundCommand: true, working: true })}
          isCollapsed
          onToggleCollapsed={vi.fn()}
          onCreateThread={vi.fn()}
          onRename={vi.fn()}
        />
      </TooltipProvider>,
    );

    const icon = screen
      .getAllByLabelText("Background command running")
      .find((element) => element.closest(".bb-sidebar-hover-actions-fade"));
    expect(icon).not.toBeUndefined();
    const overlay = icon?.closest(".bb-sidebar-hover-actions-fade");
    expect(overlay).not.toBeNull();
    expect(overlay?.className).toContain("justify-end");
    expect(overlay?.className).toContain("max-md:pointer-coarse:hidden");
    expect(
      screen
        .getAllByLabelText("Background command running")
        .some((element) =>
          element
            .closest("span")
            ?.className.includes("max-md:pointer-coarse:inline-flex"),
        ),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "New thread in Build" }),
    ).not.toBeNull();
  });
});
