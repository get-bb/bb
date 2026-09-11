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

function SnapHarness({ onResize }: { onResize: (fraction: number) => void }) {
  const { onPointerDownCapture } = usePanelResizeSnap({
    axis: "x",
    onResize,
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
  it("preserves a newer layout when the pointer is released without a preview", () => {
    const onResize = vi.fn();
    render(<SnapHarness onResize={onResize} />);
    const previous = screen.getByTestId("previous");
    const divider = screen.getByTestId("divider");
    const next = screen.getByTestId("next");
    screen.getByTestId("grid").getBoundingClientRect = () => rect(100, 800);
    previous.getBoundingClientRect = () => rect(100, 400);
    divider.getBoundingClientRect = () => rect(500, 1);
    next.getBoundingClientRect = () => rect(501, 399);
    previous.style.flex = "50 1 0px";
    next.style.flex = "50 1 0px";

    fireEvent.pointerDown(divider, { clientX: 500, pointerId: 46 });
    previous.style.flex = "60 1 0px";
    next.style.flex = "40 1 0px";
    fireEvent.pointerUp(window, { clientX: 500, pointerId: 46 });

    expect(onResize).not.toHaveBeenCalled();
    expect(previous.style.flex).toBe("60 1 0px");
    expect(next.style.flex).toBe("40 1 0px");
  });

  it("restores the committed layout before a resize that clamps to the existing limit", () => {
    const onResize = vi.fn();
    render(<SnapHarness onResize={onResize} />);
    const previous = screen.getByTestId("previous");
    const divider = screen.getByTestId("divider");
    const next = screen.getByTestId("next");
    screen.getByTestId("grid").getBoundingClientRect = () => rect(100, 800);
    previous.getBoundingClientRect = () => rect(100, 240);
    divider.getBoundingClientRect = () => rect(340, 1);
    next.getBoundingClientRect = () => rect(341, 559);
    previous.style.flex = "30 1 0px";
    next.style.flex = "70 1 0px";
    onResize.mockImplementation(() => {
      expect(previous.style.flex).toBe("30 1 0px");
      expect(next.style.flex).toBe("70 1 0px");
    });

    fireEvent.pointerDown(divider, { clientX: 340, pointerId: 45 });
    fireEvent.pointerMove(document.body, {
      buttons: 1,
      clientX: 220,
      pointerId: 45,
    });
    expect(previous.style.flex).toBe("15 1 0px");
    expect(next.style.flex).toBe("85 1 0px");

    fireEvent.pointerUp(window, { clientX: 220, pointerId: 45 });

    expect(onResize).toHaveBeenCalledExactlyOnceWith(0.15);
    expect(previous.style.flex).toBe("30 1 0px");
    expect(next.style.flex).toBe("70 1 0px");
  });

  it("previews pointer movement locally and commits once at drag end", () => {
    const onResize = vi.fn();
    render(<SnapHarness onResize={onResize} />);
    const grid = screen.getByTestId("grid");
    const previous = screen.getByTestId("previous");
    const divider = screen.getByTestId("divider");
    const hitTarget = screen.getByTestId("hit-target");
    const next = screen.getByTestId("next");
    grid.getBoundingClientRect = () => rect(100, 800);
    previous.getBoundingClientRect = () => rect(100, 370);
    divider.getBoundingClientRect = () => rect(470, 1);
    next.getBoundingClientRect = () => rect(471, 429);
    const rawPanelMove = vi.fn();
    document.body.addEventListener("pointermove", rawPanelMove, true);

    try {
      fireEvent.pointerDown(hitTarget, { clientX: 470, pointerId: 40 });
      fireEvent.pointerMove(document.body, {
        buttons: 1,
        clientX: 450,
        pointerId: 40,
      });

      expect(rawPanelMove).not.toHaveBeenCalled();
      expect(onResize).not.toHaveBeenCalled();
      expect(previous.style.flex).toBe("0.4375 1 0px");
      expect(next.style.flex).toBe("0.5625 1 0px");

      fireEvent.pointerUp(window, { clientX: 450, pointerId: 40 });
      expect(onResize).toHaveBeenCalledOnce();
      expect(onResize).toHaveBeenLastCalledWith(0.4375);
    } finally {
      fireEvent.pointerUp(window, { clientX: 450, pointerId: 40 });
      document.body.removeEventListener("pointermove", rawPanelMove, true);
    }
  });

  it("disables panel-size transitions only for the active pointer drag", () => {
    const onResize = vi.fn();
    render(<SnapHarness onResize={onResize} />);
    const grid = screen.getByTestId("grid");
    const previous = screen.getByTestId("previous");
    const divider = screen.getByTestId("divider");
    const hitTarget = screen.getByTestId("hit-target");
    const next = screen.getByTestId("next");
    grid.getBoundingClientRect = () => rect(100, 800);
    previous.getBoundingClientRect = () => rect(100, 370);
    divider.getBoundingClientRect = () => rect(470, 1);
    next.getBoundingClientRect = () => rect(471, 429);
    grid.style.setProperty("--panel-collapse-duration", "220ms");

    fireEvent.pointerDown(hitTarget, { clientX: 470, pointerId: 42 });
    expect(grid.style.getPropertyValue("--panel-collapse-duration")).toBe(
      "0ms",
    );

    fireEvent.pointerUp(window, { clientX: 470, pointerId: 42 });
    expect(grid.style.getPropertyValue("--panel-collapse-duration")).toBe(
      "220ms",
    );
  });

  it("releases when the panel library consumes pointerup before the snap handler", () => {
    const onResize = vi.fn();
    render(<SnapHarness onResize={onResize} />);
    const grid = screen.getByTestId("grid");
    const previous = screen.getByTestId("previous");
    const divider = screen.getByTestId("divider");
    const hitTarget = screen.getByTestId("hit-target");
    const next = screen.getByTestId("next");
    grid.getBoundingClientRect = () => rect(100, 800);
    previous.getBoundingClientRect = () => rect(100, 370);
    divider.getBoundingClientRect = () => rect(470, 1);
    next.getBoundingClientRect = () => rect(471, 429);
    grid.style.setProperty("--panel-collapse-duration", "220ms");
    const consumePointerUp = (event: PointerEvent) =>
      event.stopImmediatePropagation();
    window.addEventListener("pointerup", consumePointerUp, true);

    try {
      fireEvent.pointerDown(hitTarget, { clientX: 470, pointerId: 43 });
      fireEvent.pointerMove(document.body, {
        buttons: 1,
        clientX: 450,
        pointerId: 43,
      });
      fireEvent.pointerUp(document.body, { clientX: 450, pointerId: 43 });
      fireEvent.mouseUp(window, { clientX: 450 });
      expect(onResize).toHaveBeenCalledOnce();
      expect(onResize).toHaveBeenLastCalledWith(0.4375);
      const resizeCountAfterRelease = onResize.mock.calls.length;

      fireEvent.pointerMove(document.body, {
        buttons: 0,
        clientX: 430,
        pointerId: 43,
      });

      expect(onResize).toHaveBeenCalledTimes(resizeCountAfterRelease);
      expect(grid.style.getPropertyValue("--panel-collapse-duration")).toBe(
        "220ms",
      );
    } finally {
      window.removeEventListener("pointerup", consumePointerUp, true);
    }
  });

  it("releases when pointer movement reports that no buttons remain held", () => {
    const onResize = vi.fn();
    render(<SnapHarness onResize={onResize} />);
    const grid = screen.getByTestId("grid");
    const previous = screen.getByTestId("previous");
    const divider = screen.getByTestId("divider");
    const hitTarget = screen.getByTestId("hit-target");
    const next = screen.getByTestId("next");
    grid.getBoundingClientRect = () => rect(100, 800);
    previous.getBoundingClientRect = () => rect(100, 370);
    divider.getBoundingClientRect = () => rect(470, 1);
    next.getBoundingClientRect = () => rect(471, 429);
    grid.style.setProperty("--panel-collapse-duration", "220ms");

    fireEvent.pointerDown(hitTarget, { clientX: 470, pointerId: 44 });
    fireEvent.pointerMove(document.body, {
      buttons: 0,
      clientX: 450,
      pointerId: 44,
    });

    expect(onResize).not.toHaveBeenCalled();
    expect(grid.style.getPropertyValue("--panel-collapse-duration")).toBe(
      "220ms",
    );
  });

  it("bridges a fast outer-panel crossing into the shared two-pane grid", () => {
    const onResize = vi.fn();
    render(<SnapHarness onResize={onResize} />);
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
    fireEvent.pointerMove(document.body, {
      buttons: 1,
      clientX: 560,
      pointerId: 41,
    });

    expect(onResize).not.toHaveBeenCalled();
    expect(previous.style.flex).toBe("0.5 1 0px");
    expect(next.style.flex).toBe("0.5 1 0px");
    expect(
      document.querySelector("[data-split-resize-snap-guide]"),
    ).not.toBeNull();

    fireEvent.pointerUp(window, { clientX: 560, pointerId: 41 });
    expect(onResize).toHaveBeenLastCalledWith(0.5);
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });
});
