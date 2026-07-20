// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopLevelSidebarSection } from "./ProjectList";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TopLevelSidebarSection", () => {
  it("hides the section body and exposes an expand action when collapsed", () => {
    render(
      <TopLevelSidebarSection
        label="Pinned"
        collapseControl={{ isCollapsed: true, onToggleCollapsed: vi.fn() }}
      >
        <div>Pinned thread</div>
      </TopLevelSidebarSection>,
    );

    expect(screen.queryByText("Pinned thread")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand Pinned section" }),
    ).not.toBeNull();
  });

  it("renders the disclosure and optional icon before the section label", () => {
    const result = render(
      <TopLevelSidebarSection
        label="Pinned"
        leadingIcon="Pin"
        collapseControl={{ isCollapsed: false, onToggleCollapsed: vi.fn() }}
      >
        <div>Pinned thread</div>
      </TopLevelSidebarSection>,
    );

    const disclosure = screen.getByRole("button", {
      name: "Collapse Pinned section",
    });
    const icon = result.container.querySelector('[data-icon="Pin"]');
    const label = screen.getByTitle("Pinned");

    expect(icon).not.toBeNull();
    expect(
      disclosure.compareDocumentPosition(icon as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      (icon as Element).compareDocumentPosition(label) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("reserves only the rendered action width beside a long section label", () => {
    render(
      <TopLevelSidebarSection
        label="Sawyer's MacBook Pro"
        actions={<button type="button">Display options</button>}
      >
        <div>Machine thread</div>
      </TopLevelSidebarSection>,
    );

    const label = screen.getByTitle("Sawyer's MacBook Pro");
    const action = screen.getByRole("button", { name: "Display options" });

    expect(label.parentElement?.className).not.toContain("pr-[7.5rem]");
    expect(action.parentElement?.className).toContain("shrink-0");
    expect(action.parentElement?.className).not.toContain("absolute");
  });
});
