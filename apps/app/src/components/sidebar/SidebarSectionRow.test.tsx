// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@/lib/thread-activity";
import { SidebarSectionRow } from "./SidebarSectionRow";

afterEach(() => cleanup());

describe("SidebarSectionRow", () => {
  it("renders the section icon and name before the disclosure at the requested depth", () => {
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

    expect(icon).not.toBeNull();
    expect(
      (icon as Element).compareDocumentPosition(label) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      label.compareDocumentPosition(disclosure) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(row?.style.paddingLeft).toBe("32px");
  });
});
