// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  SidebarMore,
  SidebarOverflowItem,
} from "./SidebarVisibilityControls.js";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityCustomize.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("shared sidebar visibility controls", () => {
  it("loads group customization and toggles visibility without navigating away", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(onVisibleChange).toHaveBeenCalledWith("section:review", true);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("button", { name: "Review" }), {
      key: "Escape",
    });
    expect(onDone).toHaveBeenCalledOnce();
  });
});

describe("thread overflow submenus", () => {
  it("starts closed, opens a section with the keyboard, and resets on reopen", async () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <SidebarMore
          ariaLabel="More sections"
          listLabel="Hidden sections"
          customizeLabel="Customize list"
          onCustomize={() => {}}
        >
          {(close) => (
            <SidebarOverflowItem
              item={{ id: "review", title: "Review" }}
              onClose={close}
              onAddToSidebar={() => {}}
            >
              {(closeSection) => (
                <button onClick={closeSection}>Review thread</button>
              )}
            </SidebarOverflowItem>
          )}
        </SidebarMore>
      </CompactViewportOverrideProvider>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More sections" }), {
      key: "Enter",
    });
    const section = await screen.findByRole("menuitem", { name: "Review" });
    expect(screen.queryByRole("button", { name: "Review thread" })).toBeNull();
    fireEvent.keyDown(section, { key: "ArrowRight" });
    fireEvent.click(
      await screen.findByRole("button", { name: "Review thread" }),
    );
    fireEvent.keyDown(screen.getByRole("button", { name: "More sections" }), {
      key: "Enter",
    });
    await screen.findByRole("menuitem", { name: "Review" });
    expect(screen.queryByRole("button", { name: "Review thread" })).toBeNull();
  });

  it("closes both compact drawers when a thread is selected", () => {
    vi.useFakeTimers();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <SidebarMore
          ariaLabel="More sections"
          listLabel="Hidden sections"
          customizeLabel="Customize list"
          onCustomize={() => {}}
        >
          {(close) => (
            <SidebarOverflowItem
              item={{ id: "review", title: "Review" }}
              onClose={close}
              onAddToSidebar={() => {}}
            >
              {(closeSection) => (
                <button onClick={closeSection}>Review thread</button>
              )}
            </SidebarOverflowItem>
          )}
        </SidebarMore>
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More sections" }));
    act(() => vi.advanceTimersByTime(120));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    act(() => vi.advanceTimersByTime(120));
    fireEvent.click(screen.getByRole("button", { name: "Review thread" }));

    expect(
      screen.getByRole("button", { name: "More sections" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Review thread" })).toBeNull();
  });
});
