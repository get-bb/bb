// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@/lib/thread-activity";
import { SidebarSectionRow } from "./SidebarSectionRow";

afterEach(() => cleanup());

describe("SidebarSectionRow", () => {
  it("renders the section name before the disclosure without a sidebar icon", () => {
    const result = render(
      <SidebarSectionRow
        name="Nested work"
        label="Nested work"
        depth={1}
        activity={NO_COLLAPSED_CHILD_ACTIVITY}
        isCollapsed={false}
        onToggleCollapsed={vi.fn()}
      />,
    );

    const disclosure = screen.getByRole("button", {
      name: "Collapse Nested work section",
    });
    const icon = result.container.querySelector('[data-icon="ListView"]');
    const label = screen.getByText("Nested work");
    const row = label.parentElement?.parentElement as HTMLElement | null;

    expect(icon).toBeNull();
    expect(
      label.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(row?.style.paddingLeft).toBe("32px");
  });

  it("pins collapsed child activity to the row edge independently of section actions", () => {
    render(
      <TooltipProvider>
        <SidebarSectionRow
          name="Build"
          label="Build"
          depth={1}
          activity={{
            ...NO_COLLAPSED_CHILD_ACTIVITY,
            working: true,
            runtimeWorking: true,
          }}
          isCollapsed
          onToggleCollapsed={vi.fn()}
          onCreateThread={vi.fn()}
          onRename={vi.fn()}
        />
      </TooltipProvider>,
    );

    const edgeSlot = screen
      .getAllByLabelText("Thread working")
      .map((indicator) =>
        indicator.closest("[data-sidebar-collapsed-activity-edge]"),
      )
      .find((slot) => slot !== null);

    expect(edgeSlot).toBeInstanceOf(HTMLElement);
    expect((edgeSlot as HTMLElement).className).toContain("absolute");
    expect((edgeSlot as HTMLElement).className).toContain("right-0");
  });
});
