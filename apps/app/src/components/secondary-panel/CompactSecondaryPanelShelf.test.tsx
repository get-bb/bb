// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactSecondaryPanelShelf } from "./CompactSecondaryPanelShelf";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import { getCompactSecondaryPanelPresentation } from "@/components/ui/secondary-panel-shelf-visibility";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderShelf(
  open: boolean,
  presentation: "shelf" | "full" = "shelf",
  onClose = vi.fn(),
) {
  const view = render(
    <CompactSecondaryPanelShelf
      open={open}
      onClose={onClose}
      presentation={presentation}
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
    expect(shelf.style.zIndex).toBe(String(APP_OVERLAY_LAYER.secondaryPanel));
    expect(shelf.className).toContain("w-(--secondary-panel-width-mobile)");
    expect(shelf.className).not.toContain("bottom-0");
  });

  it("fills the viewport for a full-page tab and keeps the shelf width otherwise", () => {
    const { rerender } = renderShelf(true, "shelf");
    const shelf = screen.getByTestId("secondary-panel-shelf");
    expect(shelf.dataset.state).toBe("shelf");
    expect(shelf.className).toContain("data-[state=full]:w-full");

    rerender(
      <CompactSecondaryPanelShelf
        open
        onClose={vi.fn()}
        presentation="full"
        srLabel="Right panel"
      >
        <div data-testid="panel-body" />
      </CompactSecondaryPanelShelf>,
    );
    expect(screen.getByTestId("secondary-panel-shelf").dataset.state).toBe(
      "full",
    );
  });

  it("stacks the full page panel above app chrome and below shared overlays", () => {
    renderShelf(true, "full");

    const shelf = screen.getByTestId("secondary-panel-shelf");
    expect(shelf.style.zIndex).toBe(
      String(APP_OVERLAY_LAYER.secondaryPanelFullPage),
    );
    expect(APP_OVERLAY_LAYER.secondaryPanelFullPage).toBeGreaterThan(
      APP_OVERLAY_LAYER.sidebarTrigger,
    );
    expect(APP_OVERLAY_LAYER.sharedPortaledOverlay).toBeGreaterThan(
      APP_OVERLAY_LAYER.secondaryPanelFullPage,
    );
  });

  it("stops the dismiss layer from swallowing taps once the panel is full page", () => {
    renderShelf(true, "full");

    const dismiss = screen.getByTestId("secondary-panel-shelf-dismiss");
    expect(dismiss.className).toContain(
      "data-[state=full]:pointer-events-none",
    );
    expect(dismiss.className).toContain("data-[state=full]:-translate-x-full");
  });

  it("leaves the page undimmed and dismisses from the exposed strip", () => {
    const { onClose } = renderShelf(true);

    const dismiss = screen.getByTestId("secondary-panel-shelf-dismiss");
    expect(dismiss.style.zIndex).toBe(
      String(APP_OVERLAY_LAYER.secondaryPanelDismiss),
    );
    expect(APP_OVERLAY_LAYER.sidebarTrigger).toBeGreaterThan(
      APP_OVERLAY_LAYER.secondaryPanelDismiss,
    );
    expect(dismiss.className).toContain("bg-transparent");
    expect(dismiss.className).toContain(
      "data-[state=shelf]:-translate-x-(--secondary-panel-width-mobile)",
    );

    fireEvent.click(dismiss);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the closed shelf so it cannot cover the sidebar shelf", () => {
    renderShelf(false);

    const shelf = screen.getByTestId("secondary-panel-shelf");
    expect(shelf.dataset.state).toBe("closed");
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
      <CompactSecondaryPanelShelf
        open
        onClose={vi.fn()}
        presentation="shelf"
        srLabel="Right panel"
      >
        <div data-testid="panel-body" />
      </CompactSecondaryPanelShelf>,
    );
    expect(
      screen.getByTestId("secondary-panel-shelf").hasAttribute("inert"),
    ).toBe(false);
  });

  it("publishes the presentation so the page knows how far to displace", () => {
    const { rerender, unmount } = renderShelf(true, "shelf");
    expect(getCompactSecondaryPanelPresentation()).toBe("shelf");

    rerender(
      <CompactSecondaryPanelShelf
        open
        onClose={vi.fn()}
        presentation="full"
        srLabel="Right panel"
      >
        <div data-testid="panel-body" />
      </CompactSecondaryPanelShelf>,
    );
    expect(getCompactSecondaryPanelPresentation()).toBe("full");

    rerender(
      <CompactSecondaryPanelShelf
        open={false}
        onClose={vi.fn()}
        presentation="full"
        srLabel="Right panel"
      >
        <div data-testid="panel-body" />
      </CompactSecondaryPanelShelf>,
    );
    expect(getCompactSecondaryPanelPresentation()).toBe("closed");

    unmount();
    expect(getCompactSecondaryPanelPresentation()).toBe("closed");
  });

  it("closes on Escape only while open", () => {
    const { onClose, rerender } = renderShelf(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <CompactSecondaryPanelShelf
        open
        onClose={onClose}
        presentation="shelf"
        srLabel="Right panel"
      >
        <div data-testid="panel-body" />
      </CompactSecondaryPanelShelf>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("contains focus, yields to nested overlays, and restores the trigger", () => {
    function FocusShelf() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open right panel
          </button>
          <CompactSecondaryPanelShelf
            open={open}
            onClose={() => setOpen(false)}
            presentation="shelf"
            srLabel="Right panel"
          >
            <button type="button">First action</button>
            <button type="button">Last action</button>
          </CompactSecondaryPanelShelf>
        </>
      );
    }

    render(<FocusShelf />);
    const trigger = screen.getByRole("button", { name: "Open right panel" });
    trigger.focus();
    fireEvent.click(trigger);
    const shelf = screen.getByRole("dialog", { name: "Right panel" });
    expect(document.activeElement).toBe(shelf);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "First action" }),
    );
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Last action" }),
    );

    const nestedAction = document.createElement("button");
    nestedAction.setAttribute("data-bb-portaled-overlay", "");
    nestedAction.addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.preventDefault();
    });
    document.body.appendChild(nestedAction);
    nestedAction.focus();
    fireEvent.keyDown(nestedAction, { key: "Tab" });
    expect(document.activeElement).toBe(nestedAction);
    fireEvent.keyDown(nestedAction, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Right panel" })).not.toBeNull();
    nestedAction.remove();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(shelf.getAttribute("data-state")).toBe("closed");
    expect(shelf.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("renders outside the transformed page so it does not slide with it", () => {
    renderShelf(true);

    const shelf = screen.getByTestId("secondary-panel-shelf");
    expect(shelf.closest('[data-sidebar="inset"]')).toBeNull();
    expect(shelf.parentElement).toBe(document.body);
  });
});
