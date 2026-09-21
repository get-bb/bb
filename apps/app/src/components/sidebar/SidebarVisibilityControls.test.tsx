// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityControls";

afterEach(cleanup);

describe("shared sidebar visibility controls", () => {
  it("lets group customization toggle visibility without navigating away", () => {
    const onVisibleChange = vi.fn();
    const onDone = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarVisibilityCustomize
          items={[{ id: "section:review", title: "Review" }]}
          visibleIds={[]}
          title="Customize list"
          listLabel="Sections"
          testIdPrefix="sidebar-thread-list"
          variant="card"
          onVisibleChange={onVisibleChange}
          onReorder={() => {}}
          onDone={onDone}
        />
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onVisibleChange).toHaveBeenCalledWith("section:review", true);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Review" }), {
      key: "Escape",
    });
    expect(onDone).toHaveBeenCalledOnce();
  });
});
