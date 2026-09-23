// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport";
import {
  SidebarMore,
  SidebarOverflowItem,
} from "./SidebarVisibilityControls.js";
import { SidebarVisibilityCustomize } from "./SidebarVisibilityCustomize.js";

installTestPluginRuntime();

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

  it("replaces the compact More drawer with a section and returns to More", () => {
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
            <>
              <SidebarOverflowItem
                item={{ id: "review", title: "Review" }}
                onClose={close}
                onAddToSidebar={() => {}}
              >
                {(closeSection) => (
                  <button onClick={closeSection}>Review thread</button>
                )}
              </SidebarOverflowItem>
              <SidebarOverflowItem
                item={{ id: "planning", title: "Planning" }}
                onClose={close}
                onAddToSidebar={() => {}}
              >
                {(closeSection) => (
                  <button onClick={closeSection}>Planning thread</button>
                )}
              </SidebarOverflowItem>
            </>
          )}
        </SidebarMore>
      </CompactViewportOverrideProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "More sections" }));
    act(() => vi.advanceTimersByTime(120));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    act(() => vi.advanceTimersByTime(120));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Planning" })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Customize list" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Review thread" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Planning" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Review thread" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Planning" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Planning thread" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Review thread" }));

    expect(
      screen
        .getByRole("button", { name: "More sections" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("button", { name: "Review thread" })).toBeNull();
  });
});
