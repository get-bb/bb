// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelGroupHandle,
} from "react-resizable-panels";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSecondaryPanelResize } from "./useSecondaryPanelResize";

vi.mock(
  "react-resizable-panels",
  () => import("@/test/react-resizable-panels-browser"),
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("sizes a lazily mounted surface from its clamped panel instead of the saved width", () => {
  function LoadedPanel() {
    const {
      secondaryPanelRef,
      secondaryResizablePanelRef,
      handleSecondaryPanelResize,
    } = useSecondaryPanelResize({
      isSecondaryPanelOpen: true,
      panelId: "secondary",
      renderAsDrawer: false,
    });
    return (
      <Panel
        id="secondary"
        ref={secondaryResizablePanelRef}
        minSize={30}
        maxSize={70}
        defaultSize={90}
        onResize={handleSecondaryPanelResize}
      >
        <aside ref={secondaryPanelRef} data-testid="surface" />
      </Panel>
    );
  }
  function Harness({ loaded }: { loaded: boolean }) {
    return (
      <PanelGroup direction="horizontal">
        <Panel id="main" minSize={30} defaultSize={10} />
        {loaded ? (
          <LoadedPanel />
        ) : (
          <Panel id="secondary" minSize={30} maxSize={70} defaultSize={90} />
        )}
      </PanelGroup>
    );
  }
  const { rerender } = render(<Harness loaded={false} />);
  rerender(<Harness loaded />);
  const surface = screen.getByTestId("surface");
  expect(surface.parentElement?.getAttribute("data-panel-size")).toBe("70.0");
  expect(surface.style.getPropertyValue("--secondary-swipe-width")).toBe(
    "70cqw",
  );
  const setProperty = vi.spyOn(surface.style, "setProperty");
  rerender(<Harness loaded />);
  expect(setProperty).not.toHaveBeenCalled();
});

it("leaves the inherited swipe width alone while dragging and applies the final width on release", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const advanceFrame = () =>
    act(() => frames.splice(0).forEach((callback) => callback(0)));
  const group = createRef<ImperativePanelGroupHandle>();
  function Harness() {
    const {
      secondaryPanelRef,
      secondaryResizablePanelRef,
      handleSecondaryPanelResize,
      resizeHitTargetRef,
    } = useSecondaryPanelResize({
      isSecondaryPanelOpen: true,
      panelId: "secondary",
      renderAsDrawer: false,
    });
    return (
      <PanelGroup ref={group} direction="horizontal">
        <Panel id="main" defaultSize={50} data-testid="main" />
        <PanelResizeHandle
          data-panel-resize-snap-handle=""
          data-testid="divider"
          hitAreaMargins={{ coarse: 0, fine: 0 }}
          tabIndex={-1}
        >
          <span ref={resizeHitTargetRef} />
        </PanelResizeHandle>
        <Panel
          id="secondary"
          ref={secondaryResizablePanelRef}
          defaultSize={50}
          onResize={handleSecondaryPanelResize}
          data-testid="secondary"
        >
          <aside ref={secondaryPanelRef} data-testid="surface" />
        </Panel>
      </PanelGroup>
    );
  }
  render(<Harness />);
  const width = 800;
  const main = screen.getByTestId("main");
  const divider = screen.getByTestId("divider");
  const secondary = screen.getByTestId("secondary");
  Object.defineProperties(divider, {
    setPointerCapture: { value: vi.fn() },
    hasPointerCapture: { value: () => true },
    releasePointerCapture: { value: vi.fn() },
  });
  const layout = () => group.current?.getLayout() ?? [0, 0];
  main.getBoundingClientRect = () =>
    new DOMRect(0, 0, (layout()[0] * width) / 100, 600);
  divider.getBoundingClientRect = () =>
    new DOMRect(main.getBoundingClientRect().right, 0, 0, 600);
  secondary.getBoundingClientRect = () =>
    new DOMRect(
      divider.getBoundingClientRect().right,
      0,
      (layout()[1] * width) / 100,
      600,
    );
  const surface = screen.getByTestId("surface");
  expect(surface.style.getPropertyValue("--secondary-swipe-width")).toBe(
    "50cqw",
  );

  fireEvent.pointerDown(divider, {
    clientX: 400,
    clientY: 100,
    button: 0,
    buttons: 1,
    pointerId: 7,
  });
  fireEvent.pointerMove(document.body, {
    buttons: 1,
    clientX: 340,
    pointerId: 7,
  });
  advanceFrame();
  fireEvent.pointerMove(document.body, {
    buttons: 1,
    clientX: 300,
    pointerId: 7,
  });
  advanceFrame();
  expect(layout()[1]).toBeCloseTo(62.5);
  expect(surface.style.getPropertyValue("--secondary-swipe-width")).toBe(
    "50cqw",
  );

  fireEvent.pointerUp(window, { pointerId: 7 });
  expect(surface.style.getPropertyValue("--secondary-swipe-width")).toBe(
    "62.5cqw",
  );
});
