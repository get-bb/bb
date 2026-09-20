// @vitest-environment jsdom
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  SidebarMore,
  SidebarOverflowItem,
  SidebarVisibilityCustomize,
} from "./SidebarVisibilityControls";

afterEach(cleanup);

function HiddenProject({ onRestore }: { onRestore: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <SidebarMore
      ariaLabel="More projects"
      listLabel="Hidden projects"
      customizeLabel="Customize thread list"
      testIdPrefix="sidebar-thread-list"
      activity={<span aria-label="Running hidden work">Running</span>}
      onCustomize={() => {}}
    >
      {(close) => (
        <SidebarOverflowItem
          item={{ id: "project:moss", title: "Moss" }}
          testIdPrefix="sidebar-thread-list"
          onClose={close}
          onAddToSidebar={onRestore}
          expanded={expanded}
          onExpandedChange={setExpanded}
        >
          <button type="button" onClick={close}>
            Review export flow
          </button>
        </SidebarOverflowItem>
      )}
    </SidebarMore>
  );
}

describe("shared sidebar visibility controls", () => {
  it("keeps More and its activity visible while browsing, then closes on restore", async () => {
    const onRestore = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <HiddenProject onRestore={onRestore} />
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More projects" }));
    fireEvent.click(await screen.findByRole("button", { name: "Moss" }));
    expect(
      screen
        .getByRole("button", { name: "Moss" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: "Review export flow" }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Running hidden work")).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("button", { name: "Moss options" }), {
      key: "Enter",
    });
    const restore = await screen.findByRole("menuitem", {
      name: "Add to sidebar",
    });
    expect(screen.getByRole("list", { name: "Hidden projects" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Customize thread list" }),
    ).toBeTruthy();
    fireEvent.click(restore);

    expect(onRestore).toHaveBeenCalledWith("project:moss");
    await waitFor(() =>
      expect(
        screen.queryByRole("list", { name: "Hidden projects" }),
      ).toBeNull(),
    );
  });

  it("lets group customization toggle visibility without navigating away", () => {
    const onVisibleChange = vi.fn();
    const onDone = vi.fn();
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarVisibilityCustomize
          items={[{ id: "section:review", title: "Review" }]}
          visibleIds={[]}
          title="Customize thread list"
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
