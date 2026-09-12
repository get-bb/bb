// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useRef } from "react";
import {
  Panel,
  PanelGroup,
  type ImperativePanelGroupHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePanelResizeSnap } from "./usePanelResizeSnap";

vi.mock("react-resizable-panels", async () => {
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve("react-resizable-panels/package.json"));
  return require(join(root, "dist/react-resizable-panels.browser.development.cjs.js"));
});

const frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 0;

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
});

afterEach(() => {
  cleanup();
  frames.clear();
  vi.restoreAllMocks();
});

function advanceFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(0)));
}

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

function setup(secondarySize = 50) {
  const group = createRef<ImperativePanelGroupHandle>();
  const onResize = vi.fn();
  function Harness() {
    const panel = useRef<ImperativePanelHandle>(null);
    const { onPointerDownCapture } = usePanelResizeSnap({
      axis: "x",
      minFraction: 0.3,
      maxFraction: 0.76,
      onResize: (fraction) => {
        onResize(fraction);
        panel.current?.resize((1 - fraction) * 100);
      },
      target: { boundaryIndex: 1, childCount: 2 },
    });
    return (
      <PanelGroup
        ref={group}
        direction="horizontal"
        data-split-resize-grid-root=""
        data-testid="grid"
      >
        <Panel id="leading" minSize={30} defaultSize={100 - secondarySize} data-testid="previous" />
        <div
          data-panel-resize-snap-handle=""
          data-testid="divider"
          onPointerDownCapture={(event) => onPointerDownCapture(event.nativeEvent)}
        />
        <Panel ref={panel} id="trailing" minSize={24} maxSize={70} defaultSize={secondarySize} data-testid="next" />
      </PanelGroup>
    );
  }
  const { unmount } = render(<Harness />);
  const previous = screen.getByTestId("previous");
  const divider = screen.getByTestId("divider");
  const next = screen.getByTestId("next");
  const grid = screen.getByTestId("grid");
  grid.getBoundingClientRect = () => rect(100, 800);
  previous.getBoundingClientRect = () => rect(100, (group.current?.getLayout()[0] ?? 0) * 8);
  divider.getBoundingClientRect = () => rect(previous.getBoundingClientRect().right, 0);
  next.getBoundingClientRect = () => rect(divider.getBoundingClientRect().right, (group.current?.getLayout()[1] ?? 0) * 8);
  const down = () => fireEvent.pointerDown(divider, {
    clientX: divider.getBoundingClientRect().left,
    pointerId: 40,
  });
  const move = (clientX: number, buttons = 1) => fireEvent.pointerMove(document.body, {
    buttons,
    clientX,
    pointerId: 40,
  });
  const release = () => fireEvent.pointerUp(window, { pointerId: 40 });
  const expectLayout = (leading: number, trailing: number) => {
    const layout = group.current?.getLayout();
    expect(layout?.[0]).toBeCloseTo(leading);
    expect(layout?.[1]).toBeCloseTo(trailing);
    expect(Number(previous.style.flexGrow)).toBeCloseTo(leading, 0);
    expect(Number(next.style.flexGrow)).toBeCloseTo(trailing, 0);
  };
  return { down, expectLayout, grid, group, move, onResize, previous, next, release, unmount };
}

describe("usePanelResizeSnap", () => {
  it("updates the panel library once per frame without a separate DOM preview", () => {
    const h = setup();
    h.down();
    h.move(450);
    h.move(440);
    h.expectLayout(50, 50);
    expect(h.onResize).not.toHaveBeenCalled();
    advanceFrame();
    h.expectLayout(42.5, 57.5);
    expect(h.onResize).toHaveBeenCalledExactlyOnceWith(0.425);

    h.move(430);
    h.move(420);
    h.move(410);
    expect(h.onResize).toHaveBeenCalledOnce();
    advanceFrame();
    h.expectLayout(38.75, 61.25);
    expect(h.onResize).toHaveBeenCalledTimes(2);
    expect(h.onResize).toHaveBeenLastCalledWith(0.3875);
    h.release();
    expect(h.onResize).toHaveBeenCalledTimes(2);
  });

  it.each([
    { secondary: 70, outside: 100, inside: 420, leading: 40 },
    { secondary: 24, outside: 1000, inside: 628, leading: 66 },
  ])("keeps the $secondary% limit and follows the pointer back inside", ({ secondary, outside, inside, leading }) => {
    const h = setup(secondary);
    h.down();
    h.move(outside);
    advanceFrame();
    h.expectLayout(100 - secondary, secondary);
    h.move(inside);
    advanceFrame();
    h.expectLayout(leading, 100 - leading);
    h.release();
    h.expectLayout(leading, 100 - leading);
  });

  it.each([false, true])("preserves a keyboard layout after a pointer update: %s", (moveFirst) => {
    const h = setup();
    h.down();
    if (moveFirst) {
      h.move(450);
      h.move(440);
      advanceFrame();
    }
    act(() => h.group.current?.setLayout([60, 40]));
    h.release();
    advanceFrame();
    h.expectLayout(60, 40);
  });

  it.each(["pointerup", "pointercancel", "mouseup", "blur", "buttons"]) ("flushes the last position before %s cleanup", (end) => {
    const h = setup();
    h.grid.style.setProperty("--panel-collapse-duration", "220ms");
    h.down();
    h.move(450);
    h.move(440);
    h.onResize.mockImplementation(() => {
      expect(h.grid.style.getPropertyValue("--panel-collapse-duration")).toBe("0ms");
    });
    if (end === "buttons") h.move(440, 0);
    else if (end === "blur") fireEvent.blur(window);
    else if (end === "mouseup") fireEvent.mouseUp(window);
    else if (end === "pointercancel") fireEvent.pointerCancel(window, { pointerId: 40 });
    else h.release();
    h.expectLayout(42.5, 57.5);
    expect(h.onResize).toHaveBeenCalledExactlyOnceWith(0.425);
    expect(h.grid.style.getPropertyValue("--panel-collapse-duration")).toBe("220ms");
    advanceFrame();
    expect(h.onResize).toHaveBeenCalledOnce();
  });

  it("blocks competing movement and leave events only during the gesture", () => {
    const h = setup();
    const rawMove = vi.fn();
    const rawLeave = vi.fn();
    document.body.addEventListener("pointermove", rawMove, true);
    document.body.addEventListener("pointerleave", rawLeave, true);
    try {
      h.down();
      h.move(450);
      h.move(440);
      fireEvent.pointerLeave(document.body, { clientX: 1000, buttons: 1, pointerId: 40 });
      expect(rawMove).not.toHaveBeenCalled();
      expect(rawLeave).not.toHaveBeenCalled();
      advanceFrame();
      h.expectLayout(42.5, 57.5);
      h.release();
      fireEvent.pointerLeave(document.body, { pointerId: 40 });
      h.move(440, 0);
      expect(rawLeave).toHaveBeenCalledOnce();
      expect(rawMove).toHaveBeenCalledOnce();
    } finally {
      document.body.removeEventListener("pointermove", rawMove, true);
      document.body.removeEventListener("pointerleave", rawLeave, true);
    }
  });

  it("drops queued updates when the owner unmounts", () => {
    const h = setup();
    h.down();
    h.move(450);
    h.move(440);
    h.unmount();
    advanceFrame();
    expect(h.onResize).not.toHaveBeenCalled();
  });

  it("keeps the shared snap guide until the gesture ends", () => {
    const h = setup(60);
    h.down();
    h.move(560);
    advanceFrame();
    h.expectLayout(50, 50);
    expect(document.querySelector("[data-split-resize-snap-guide]")).not.toBeNull();
    h.release();
    expect(document.querySelector("[data-split-resize-snap-guide]")).toBeNull();
  });
});
