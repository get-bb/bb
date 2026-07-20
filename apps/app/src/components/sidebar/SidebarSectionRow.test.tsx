// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_COLLAPSED_CHILD_ACTIVITY } from "@/lib/thread-activity";
import { SidebarSectionRow } from "./SidebarSectionRow";

afterEach(() => cleanup());

describe("SidebarSectionRow", () => {
  it("renders the disclosure before the section name at the requested depth", () => {
    render(
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
    const label = screen.getByText("Nested work");
    const row = label.parentElement?.parentElement as HTMLElement | null;

    expect(
      disclosure.compareDocumentPosition(label) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(row?.style.paddingLeft).toBe("32px");
  });
});
