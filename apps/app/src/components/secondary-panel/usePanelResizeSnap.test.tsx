// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanelResizeSnap } from "./usePanelResizeSnap";

function rect(left: number, width: number): DOMRect {
  return {
    bottom: 600,
    height: 600,
    left,
    right: left + width,
    top: 0,
    width,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

function SnapHarness({ onSnap }: { onSnap: (fraction: number) => void }) {
  const onPointerDownCapture = usePanelResizeSnap({
    axis: "x",
    onSnap,
    target: { boundaryIndex: 1, childCount: 2 },
  });
  return (
    <div data-split-resize-grid-root="" data-testid="grid">
      <div data-testid="previous" />
      <div
        data-panel-resize-snap-handle=""
        data-testid="divider"
        onPointerDownCapture={(event) =>
          onPointerDownCapture(event.nativeEvent)
        }
      >
        <span data-testid="hit-target" />
      </div>
      <div data-testid="next" />
    </div>
  );
}

afterEach(() => cleanup());

describe("usePanelResizeSnap", () => {
  it("bridges a fast outer-panel crossing into the shared two-pane grid", () => {
    const onSnap = vi.fn();
    render(<SnapHarness onSnap={onSnap} />);
    const grid = screen.getByTestId("grid");
    const previous = screen.getByTestId("previous");
    const divider = screen.getByTestId("divider");
    const hitTarget = screen.getByTestId("hit-target");
    const next = screen.getByTestId("next");
    grid.getBoundingClientRect = () => rect(100, 800);
    previous.getBoundingClientRect = () => rect(100, 370);
    divider.getBoundingClientRect = () => rect(470, 1);
    next.getBoundingClientRect = () => rect(471, 429);

    fireEvent.pointerDown(hitTarget, { clientX: 470, pointerId: 41 });
    fireEvent.pointerMove(document.body, { clientX: 560, pointerId: 41 });

    expect(onSnap).toHaveBeenLastCalledWith(0.5);
    expect(
      document.querySelector("[data-split-resize-snap-guide]"),
    ).not.toBeNull();

    fireEvent.pointerUp(window, { clientX: 560, pointerId: 41 });
    expect(
      document.querySelector("[data-split-resize-snap-guide]"),
    ).toBeNull();
  });
});
