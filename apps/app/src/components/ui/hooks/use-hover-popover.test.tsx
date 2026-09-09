// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHoverPopover } from "./use-hover-popover";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function HoverPopoverProbe({ openDelayMs = 0 }: { openDelayMs?: number }) {
  const { open, triggerHoverProps, handleOpenChange } = useHoverPopover({
    openDelayMs,
  });
  return (
    <>
      <button type="button" data-testid="trigger" {...triggerHoverProps}>
        Trigger
      </button>
      <button type="button" onClick={() => handleOpenChange(true)}>
        Open
      </button>
      <output data-testid="open">{String(open)}</output>
    </>
  );
}

describe("useHoverPopover", () => {
  it("does not open on hover in compact viewports", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <HoverPopoverProbe />
      </CompactViewportOverrideProvider>,
    );

    fireEvent.pointerEnter(screen.getByTestId("trigger"));
    expect(screen.getByTestId("open").textContent).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByTestId("open").textContent).toBe("true");
  });

  it("still opens on hover outside compact viewports", () => {
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <HoverPopoverProbe />
      </CompactViewportOverrideProvider>,
    );

    fireEvent.pointerEnter(screen.getByTestId("trigger"));
    expect(screen.getByTestId("open").textContent).toBe("true");
  });

  it("clears pending hover transitions when switching to compact viewports", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <HoverPopoverProbe openDelayMs={100} />
      </CompactViewportOverrideProvider>,
    );

    fireEvent.pointerEnter(screen.getByTestId("trigger"));
    expect(screen.getByTestId("open").textContent).toBe("false");

    rerender(
      <CompactViewportOverrideProvider isCompactViewport>
        <HoverPopoverProbe openDelayMs={100} />
      </CompactViewportOverrideProvider>,
    );
    vi.advanceTimersByTime(100);

    expect(screen.getByTestId("open").textContent).toBe("false");
  });
});
