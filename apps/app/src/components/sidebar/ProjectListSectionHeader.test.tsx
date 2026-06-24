// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopLevelSidebarSection } from "./ProjectList";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TopLevelSidebarSection", () => {
  it("does not toggle collapse when the section label row is clicked", () => {
    const onToggleCollapsed = vi.fn();

    render(
      <TopLevelSidebarSection
        label="Projects"
        collapseControl={{ isCollapsed: false, onToggleCollapsed }}
      >
        <div>Section body</div>
      </TopLevelSidebarSection>,
    );

    fireEvent.click(screen.getByText("Projects"));

    expect(onToggleCollapsed).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Projects section" }),
    );

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("keeps hover-revealed actions without applying row hover background", () => {
    const { container } = render(
      <TopLevelSidebarSection
        label="Threads"
        actions={<button type="button">New thread</button>}
        collapseControl={{ isCollapsed: false, onToggleCollapsed: vi.fn() }}
      >
        <div>Section body</div>
      </TopLevelSidebarSection>,
    );

    const header = container.querySelector(".bb-sidebar-hover-actions-row");
    expect(header).not.toBeNull();
    expect(header?.className).not.toContain("hover:bg-sidebar-accent");

    const collapseButton = screen.getByRole("button", {
      name: "Collapse Threads section",
    });
    expect(collapseButton.className).toContain("hover:bg-sidebar-accent");
    expect(
      collapseButton.getAttribute("data-sidebar-hover-actions-mobile"),
    ).toBe("always");
    expect(
      screen.getByRole("button", { name: "New thread" }).closest(
        ".bb-sidebar-hover-actions",
      ),
    ).not.toBeNull();
  });
});
