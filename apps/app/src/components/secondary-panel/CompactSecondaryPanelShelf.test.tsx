// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactSecondaryPanelShelf } from "./CompactSecondaryPanelShelf";
import { isCompactSecondaryPanelShelfShowing } from "@/components/ui/secondary-panel-shelf-visibility";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderShelf(open: boolean, onClose = vi.fn()) {
  const view = render(
    <CompactSecondaryPanelShelf
      open={open}
      onClose={onClose}
      srLabel="Right panel"
    >
      <div data-testid="panel-body" />
    </CompactSecondaryPanelShelf>,
  );
  return { ...view, onClose };
}

describe("CompactSecondaryPanelShelf", () => {
  it("anchors to the right edge beneath the page rather than the bottom", () => {
    renderShelf(true);

    const shelf = screen.getByTestId("secondary-panel-shelf");
    expect(shelf.className).toContain("right-0");
    expect(shelf.className).toContain("inset-y-0");
    expect(shelf.className).toContain("z-0");
    expect(shelf.className).toContain("w-(--secondary-panel-width-mobile)");
    expect(shelf.className).not.toContain("bottom-0");
    expect(shelf.className).not.toContain("rounded-t-xl");
  });

  it("leaves the page undimmed and dismisses from the exposed strip", () => {
    const { onClose } = renderShelf(true);

    const dismiss = screen.getByTestId("secondary-panel-shelf-dismiss");
    expect(dismiss.className).toContain("bg-transparent");
    expect(dismiss.className).toContain(
      "data-[state=open]:-translate-x-(--secondary-panel-width-mobile)",
    );

    fireEvent.click(dismiss);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the closed shelf so it cannot cover the sidebar shelf", () => {
    renderShelf(false);

    const shelf = screen.getByTestId("secondary-panel-shelf");
    expect(shelf.className).toContain("data-[state=closed]:invisible");
    expect(shelf.className).toContain(
      "data-[state=closed]:[transition:visibility_0s_linear_220ms]",
    );
  });

  it("marks the shelf inert while closed and interactive while open", () => {
    const { rerender } = renderShelf(false);
    expect(
      screen.getByTestId("secondary-panel-shelf").hasAttribute("inert"),
    ).toBe(true);

    rerender(
      <CompactSecondaryPanelShelf open onClose={vi.fn()} srLabel="Right panel">
        <div data-testid="panel-body" />
      </CompactSecondaryPanelShelf>,
    );
    expect(
      screen.getByTestId("secondary-panel-shelf").hasAttribute("inert"),
    ).toBe(false);
  });

  it("publishes open state so the page knows to displace", () => {
    const { rerender, unmount } = renderShelf(true);
    expect(isCompactSecondaryPanelShelfShowing()).toBe(true);

    rerender(
      <CompactSecondaryPanelShelf
        open={false}
        onClose={vi.fn()}
        srLabel="Right panel"
      >
        <div data-testid="panel-body" />
      </CompactSecondaryPanelShelf>,
    );
    expect(isCompactSecondaryPanelShelfShowing()).toBe(false);

    unmount();
    expect(isCompactSecondaryPanelShelfShowing()).toBe(false);
  });

  it("closes on Escape only while open", () => {
    const { onClose, rerender } = renderShelf(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <CompactSecondaryPanelShelf open onClose={onClose} srLabel="Right panel">
        <div data-testid="panel-body" />
      </CompactSecondaryPanelShelf>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders outside the transformed page so it does not slide with it", () => {
    renderShelf(true);

    const shelf = screen.getByTestId("secondary-panel-shelf");
    expect(shelf.closest('[data-sidebar="inset"]')).toBeNull();
    expect(shelf.parentElement).toBe(document.body);
  });
});
