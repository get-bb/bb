// @vitest-environment jsdom

import * as React from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Provider, createStore } from "jotai";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import * as browserViewBoundsSyncModule from "@/lib/browser-view-bounds-sync";
import * as responsiveOverlayModule from "@bb/shared-ui/responsive-overlay";
import * as resizablePanelsModule from "react-resizable-panels";
import {
  PaneContext,
  type PaneContextValue,
  type PaneSecondaryPanelViewModel,
} from "@/views/thread-detail/PaneContext";
import { secondaryPanelWidthPercentAtom } from "./threadSecondaryPanelAtoms";
import {
  SecondaryPanelLayout,
  type SecondaryPanelRenderArgs,
} from "./SecondaryPanelLayout";

type DrawerShellCallback = (open: boolean) => void;

const panelGroupState = vi.hoisted(() => ({
  getLayout: vi.fn(() => [60, 40]),
  setLayout: vi.fn(),
}));
const drawerShellState = vi.hoisted(() => ({
  onContentAnimationEnd:
    /* SAFETY: The test controls this fixture and verifies its behavior. */ undefined as
      | DrawerShellCallback
      | undefined,
}));

const dispatchBrowserViewBoundsSyncSpy = vi.spyOn(
  browserViewBoundsSyncModule,
  "dispatchBrowserViewBoundsSync",
);

const PanelGroup = React.forwardRef<
  {
    getLayout: () => number[];
    setLayout: (layout: number[]) => void;
  },
  { children?: ReactNode }
>(({ children, ...props }, ref) => {
  React.useImperativeHandle(
    ref,
    () => ({
      getId: () => "test-panel-group",
      getLayout: panelGroupState.getLayout,
      setLayout: panelGroupState.setLayout,
    }),
    [],
  );
  return React.createElement(
    "div",
    { ...props, "data-testid": "panel-group" },
    children,
  );
});
PanelGroup.displayName = "TestPanelGroup";

const Panel = ({ children }: { children?: ReactNode }) =>
  React.createElement("div", { "data-testid": "main-panel" }, children);

type DrawerShellProps = Parameters<
  typeof responsiveOverlayModule.PersistentResponsiveDrawerShell
>[0];

const PersistentResponsiveDrawerShell = ({
  children,
  onContentAnimationEnd,
  open,
}: DrawerShellProps) => {
  drawerShellState.onContentAnimationEnd = onContentAnimationEnd;
  return createPortal(
    React.createElement(
      "div",
      {
        "data-open": String(open),
        "data-testid": "responsive-drawer-shell",
      },
      children,
    ),
    document.body,
  );
};

const layoutDependencies = {
  Panel:
    /* SAFETY: The test panel implements the component contract used by SecondaryPanelLayout. */ Panel as typeof resizablePanelsModule.Panel,
  PanelGroup:
    /* SAFETY: The test panel group implements the ref and child contract used by SecondaryPanelLayout. */ PanelGroup as typeof resizablePanelsModule.PanelGroup,
  ResponsiveDrawerShell: PersistentResponsiveDrawerShell,
  dispatchBrowserViewBoundsSync: dispatchBrowserViewBoundsSyncSpy,
};

interface QueuedAnimationFrames {
  cancelAnimationFrame: ReturnType<typeof vi.spyOn>;
  flushAll: () => void;
  requestAnimationFrame: ReturnType<typeof vi.spyOn>;
  size: () => number;
}

interface RenderLayoutArgs {
  collapseActive?: boolean;
  isCompactViewport: boolean;
  isFocusedHosted?: boolean;
  open: boolean;
  panelGroupKey?: string;
  renderPanel: (args: SecondaryPanelRenderArgs) => ReactNode;
  resetKey: string;
}

const noop = () => {};
let publishedHostedPanel: PaneSecondaryPanelViewModel | null = null;
const hostedPaneRegistration = {
  clear: () => {
    publishedHostedPanel = null;
  },
  publish: (model: PaneSecondaryPanelViewModel) => {
    publishedHostedPanel = model;
  },
};

function withHostedPane(
  children: ReactNode,
  isFocusedHosted: boolean | undefined,
): ReactNode {
  if (isFocusedHosted === undefined) {
    return children;
  }
  const value: PaneContextValue = {
    paneId: "pane-test",
    isFocused: isFocusedHosted,
    isSplitPane: true,
    secondaryPanelHost: hostedPaneRegistration,
    reservesWindowPanelToggle: false,
    onRequestClose: noop,
    isMaximized: false,
    onToggleMaximize: noop,
    isBoundedPane: true,
    isTopRow: true,
    ownsWindowTopLeft: true,
    navigateInPane: noop,
  };
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

function renderLayout(args: RenderLayoutArgs) {
  let renderArgs = args;
  const store = createStore();
  store.set(secondaryPanelWidthPercentAtom, 40);
  const renderContent = () =>
    withHostedPane(
      <Provider store={store}>
        <CompactViewportOverrideProvider
          isCompactViewport={renderArgs.isCompactViewport}
        >
          <SecondaryPanelLayout
            open={renderArgs.open}
            onToggle={noop}
            onClose={noop}
            panelGroupKey={renderArgs.panelGroupKey}
            resetKey={renderArgs.resetKey}
            contentKey={renderArgs.resetKey}
            drawerLabel="Details"
            drawerFallback={<div data-testid="drawer-fallback" />}
            mainPanelId="test-main-panel"
            main={<main data-testid="main-content" />}
            collapse={
              renderArgs.collapseActive === undefined
                ? undefined
                : { active: renderArgs.collapseActive, onToggle: noop }
            }
            renderPanel={renderArgs.renderPanel}
            composerHost={null}
            dependencies={layoutDependencies}
          />
        </CompactViewportOverrideProvider>
      </Provider>,
      renderArgs.isFocusedHosted,
    );
  const view = render(renderContent());

  return {
    ...view,
    rerenderWith(nextArgs: Partial<RenderLayoutArgs>) {
      renderArgs = { ...renderArgs, ...nextArgs };
      view.rerender(renderContent());
    },
  };
}

function createPanelRenderer(order?: string[]) {
  return vi.fn((args: SecondaryPanelRenderArgs) => {
    order?.push(`render:${String(args.canShowNativeBrowserView)}`);
    return (
      <section
        data-can-show-native-browser-view={String(
          args.canShowNativeBrowserView,
        )}
        data-is-main-collapsed={String(args.isMainCollapsed)}
        data-resizable-panel-id={args.resizablePanelId}
        data-testid={`${args.presentation}-secondary-panel`}
      />
    );
  });
}

function installAnimationFrameQueue(order?: string[]): QueuedAnimationFrames {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;

  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: noop,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: noop,
  });

  const requestAnimationFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      callbacks.set(frameId, callback);
      order?.push("requestAnimationFrame");
      return frameId;
    });
  const cancelAnimationFrame = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation((frameId) => {
      callbacks.delete(frameId);
    });

  return {
    cancelAnimationFrame,
    flushAll() {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pendingCallbacks) {
        callback(performance.now());
      }
    },
    requestAnimationFrame,
    size: () => callbacks.size,
  };
}

function realizeDrawerPanel(frames: QueuedAnimationFrames) {
  act(() => {
    frames.flushAll();
    frames.flushAll();
  });
}

function scheduleCompactDrawerSettleFrame(open = true) {
  const callback = drawerShellState.onContentAnimationEnd;
  if (callback === undefined) {
    throw new Error("Drawer shell did not receive its animation callback");
  }
  act(() => {
    callback(open);
  });
}

function expectNativeBrowserVisibility(visible: boolean) {
  expect(
    screen
      .getByTestId("drawer-secondary-panel")
      .getAttribute("data-can-show-native-browser-view"),
  ).toBe(String(visible));
}

const PRISTINE_REQUEST_ANIMATION_FRAME = window.requestAnimationFrame;
const PRISTINE_CANCEL_ANIMATION_FRAME = window.cancelAnimationFrame;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    writable: true,
    value: PRISTINE_REQUEST_ANIMATION_FRAME,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    writable: true,
    value: PRISTINE_CANCEL_ANIMATION_FRAME,
  });
  drawerShellState.onContentAnimationEnd = undefined;
});

beforeEach(() => {
  publishedHostedPanel = null;
  panelGroupState.getLayout.mockReset().mockReturnValue([60, 40]);
  panelGroupState.setLayout.mockReset();
  dispatchBrowserViewBoundsSyncSpy.mockReset();
});

describe("SecondaryPanelLayout", () => {
  it("registers the thread and right panel as one two-pane resize grid", () => {
    renderLayout({
      isCompactViewport: false,
      open: true,
      renderPanel: createPanelRenderer(),
      resetKey: "thread-grid",
    });

    expect(screen.getByTestId("panel-group").dataset.splitResizeGridRoot).toBe(
      "",
    );
  });

  it("preserves routed main content when the panel state identity changes", () => {
    const frames = installAnimationFrameQueue();
    const view = renderLayout({
      isCompactViewport: false,
      open: true,
      panelGroupKey: "plugin-pane-1",
      renderPanel: createPanelRenderer(),
      resetKey: "plugin-page-a",
    });

    act(() => {
      frames.flushAll();
      frames.flushAll();
    });
    const panelGroup = screen.getByTestId("panel-group");
    const mainContent = screen.getByTestId("main-content");
    expect(panelGroup.style.getPropertyValue("--panel-collapse-duration")).toBe(
      "500ms",
    );
    expect(
      panelGroup.style.getPropertyValue("--panel-collapse-easing"),
    ).toMatch(/^linear\(/u);
    expect(mainContent.parentElement?.className).toContain(
      "motion-reduce:duration-0",
    );

    view.rerenderWith({ resetKey: "plugin-page-b" });

    expect(screen.getByTestId("panel-group")).toBe(panelGroup);
    expect(screen.getByTestId("main-content")).toBe(mainContent);
    expect(panelGroup.style.getPropertyValue("--panel-collapse-duration")).toBe(
      "0ms",
    );
  });

  it("settles mount-time panel state before enabling layout transitions", () => {
    const frames = installAnimationFrameQueue();
    const view = renderLayout({
      isCompactViewport: false,
      open: true,
      renderPanel: createPanelRenderer(),
      resetKey: "plugin-page",
    });

    const panelGroup = screen.getByTestId("panel-group");
    expect(panelGroup.style.getPropertyValue("--panel-collapse-duration")).toBe(
      "0ms",
    );

    view.rerenderWith({ open: false });
    act(() => frames.flushAll());
    expect(panelGroup.style.getPropertyValue("--panel-collapse-duration")).toBe(
      "0ms",
    );

    act(() => frames.flushAll());
    expect(panelGroup.style.getPropertyValue("--panel-collapse-duration")).toBe(
      "500ms",
    );
  });

  it("waits for a secondary panel before applying a two-panel layout", () => {
    panelGroupState.getLayout.mockReturnValue([100]);
    const view = renderLayout({
      isCompactViewport: false,
      open: false,
      renderPanel: () => null,
      resetKey: "plugin-page",
    });

    expect(panelGroupState.setLayout).not.toHaveBeenCalled();

    panelGroupState.getLayout.mockReturnValue([60, 40]);
    const renderPanel = createPanelRenderer();
    view.rerenderWith({ open: true, renderPanel });

    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([60, 40]);
  });

  it("owns the animated desktop open, closed, and conversation layouts", () => {
    const renderPanel = createPanelRenderer();
    const view = renderLayout({
      collapseActive: false,
      isCompactViewport: false,
      open: false,
      renderPanel,
      resetKey: "thread-1",
    });

    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([100, 0]);
    expect(renderPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ canShowNativeBrowserView: false }),
    );
    const mountedPanel = screen.getByTestId("inline-secondary-panel");

    panelGroupState.setLayout.mockClear();
    view.rerenderWith({ open: true });
    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([60, 40]);
    expect(renderPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ canShowNativeBrowserView: true }),
    );

    panelGroupState.setLayout.mockClear();
    view.rerenderWith({ collapseActive: true });
    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([0, 100]);
    expect(
      screen.getByTestId("main-content").closest("[inert]"),
    ).not.toBeNull();
    expect(
      screen
        .getByTestId("inline-secondary-panel")
        .getAttribute("data-is-main-collapsed"),
    ).toBe("true");
    expect(screen.getByTestId("inline-secondary-panel")).toBe(mountedPanel);

    panelGroupState.setLayout.mockClear();
    view.rerenderWith({ collapseActive: false });
    expect(panelGroupState.setLayout).toHaveBeenCalledTimes(1);
    expect(panelGroupState.setLayout).toHaveBeenLastCalledWith([60, 40]);
  });

  it("publishes one hosted panel model and gates native content on pane focus", () => {
    const frames = installAnimationFrameQueue();
    const renderPanel = createPanelRenderer();
    const view = renderLayout({
      collapseActive: true,
      isCompactViewport: false,
      isFocusedHosted: true,
      open: true,
      renderPanel,
      resetKey: "thread-1",
    });

    expect(screen.queryByTestId("panel-group")).toBeNull();
    expect(publishedHostedPanel).toMatchObject({
      contentKey: "thread-1",
      isMainCollapsed: true,
      isOpen: true,
      transitionsReady: false,
    });
    expect(renderPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        presentation: "inline",
        canShowNativeBrowserView: true,
        inlinePanelToggle: "reserved",
        isMainCollapsed: true,
        resizablePanelId: "thread-detail-secondary-panel-pane-test",
      }),
    );
    expect(publishedHostedPanel?.onToggle).toBe(noop);

    act(() => {
      frames.flushAll();
      frames.flushAll();
    });
    expect(publishedHostedPanel?.transitionsReady).toBe(true);

    view.rerenderWith({ isFocusedHosted: false });
    expect(renderPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ canShowNativeBrowserView: false }),
    );
  });

  it("realizes compact content before enabling the native browser view", () => {
    const order: string[] = [];
    const frames = installAnimationFrameQueue(order);
    dispatchBrowserViewBoundsSyncSpy.mockImplementation(() => {
      order.push("dispatchBrowserViewBoundsSync");
    });
    const renderPanel = createPanelRenderer(order);

    const view = renderLayout({
      isCompactViewport: true,
      open: true,
      renderPanel,
      resetKey: "thread-1",
    });

    expect(screen.queryByTestId("drawer-secondary-panel")).toBeNull();
    expect(screen.getByTestId("drawer-fallback")).not.toBeNull();
    expect(panelGroupState.setLayout).not.toHaveBeenCalled();
    realizeDrawerPanel(frames);
    expectNativeBrowserVisibility(false);

    order.push("animationEnd:true");
    scheduleCompactDrawerSettleFrame();
    expect(dispatchBrowserViewBoundsSyncSpy).not.toHaveBeenCalled();

    act(() => {
      frames.flushAll();
    });

    expectNativeBrowserVisibility(true);
    expect(order).toEqual([
      "render:false",
      "requestAnimationFrame",
      "requestAnimationFrame",
      "animationEnd:true",
      "requestAnimationFrame",
      "dispatchBrowserViewBoundsSync",
      "render:true",
    ]);
    const mountedPanel = screen.getByTestId("drawer-secondary-panel");
    view.rerenderWith({ open: false });
    expect(screen.getByTestId("drawer-secondary-panel")).toBe(mountedPanel);
    view.rerenderWith({ open: true });
    expect(screen.getByTestId("drawer-secondary-panel")).toBe(mountedPanel);
  });

  it("realizes compact content through the timeout fallback", () => {
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: noop,
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: noop,
    });
    vi.useFakeTimers();
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn(() => 1),
    });
    Object.defineProperty(window, "cancelAnimationFrame", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    try {
      renderLayout({
        isCompactViewport: true,
        open: true,
        renderPanel: createPanelRenderer(),
        resetKey: "thread-1",
      });
      expect(screen.queryByTestId("drawer-secondary-panel")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(120);
      });

      expect(screen.getByTestId("drawer-secondary-panel")).not.toBeNull();
    } finally {
      cleanup();
      vi.useRealTimers();
    }
  });

  it("ignores close animation completion and stale callbacks after close", () => {
    const frames = installAnimationFrameQueue();
    const view = renderLayout({
      isCompactViewport: true,
      open: true,
      renderPanel: createPanelRenderer(),
      resetKey: "thread-1",
    });

    scheduleCompactDrawerSettleFrame(false);
    expect(frames.requestAnimationFrame).toHaveBeenCalledTimes(1);

    view.rerenderWith({ open: false });
    scheduleCompactDrawerSettleFrame();
    expect(frames.size()).toBe(0);
    expect(dispatchBrowserViewBoundsSyncSpy).not.toHaveBeenCalled();
  });

  it("cancels a pending settle frame when the content identity changes", () => {
    const frames = installAnimationFrameQueue();
    const view = renderLayout({
      isCompactViewport: true,
      open: true,
      renderPanel: createPanelRenderer(),
      resetKey: "thread-1",
    });
    realizeDrawerPanel(frames);
    scheduleCompactDrawerSettleFrame();

    view.rerenderWith({ resetKey: "thread-2" });

    expect(frames.cancelAnimationFrame).toHaveBeenCalledWith(3);
    expect(frames.size()).toBe(0);
    expect(dispatchBrowserViewBoundsSyncSpy).not.toHaveBeenCalled();
  });

  it("revokes native readiness when the drawer content identity changes", () => {
    const frames = installAnimationFrameQueue();
    const view = renderLayout({
      isCompactViewport: true,
      open: true,
      renderPanel: createPanelRenderer(),
      resetKey: "thread-1",
    });
    realizeDrawerPanel(frames);
    scheduleCompactDrawerSettleFrame();
    act(() => {
      frames.flushAll();
    });
    expectNativeBrowserVisibility(true);

    view.rerenderWith({ resetKey: "thread-2" });
    expectNativeBrowserVisibility(false);
  });

  it("cancels a pending settle frame when the drawer closes", () => {
    const frames = installAnimationFrameQueue();
    const view = renderLayout({
      isCompactViewport: true,
      open: true,
      renderPanel: createPanelRenderer(),
      resetKey: "thread-1",
    });
    realizeDrawerPanel(frames);
    scheduleCompactDrawerSettleFrame();

    view.rerenderWith({ open: false });

    expect(frames.cancelAnimationFrame).toHaveBeenCalledWith(3);
    expect(frames.size()).toBe(0);
    expect(dispatchBrowserViewBoundsSyncSpy).not.toHaveBeenCalled();
  });

  it("cancels compact settling when switching wide or unmounting", () => {
    const frames = installAnimationFrameQueue();
    const renderPanel = createPanelRenderer();
    const view = renderLayout({
      isCompactViewport: true,
      open: true,
      renderPanel,
      resetKey: "thread-1",
    });
    realizeDrawerPanel(frames);
    scheduleCompactDrawerSettleFrame();

    view.rerenderWith({ isCompactViewport: false });

    expect(frames.cancelAnimationFrame).toHaveBeenCalledWith(3);
    expect(dispatchBrowserViewBoundsSyncSpy).not.toHaveBeenCalled();
    expect(renderPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ canShowNativeBrowserView: true }),
    );

    cleanup();
    vi.clearAllMocks();
    const unmountFrames = installAnimationFrameQueue();
    const mounted = renderLayout({
      isCompactViewport: true,
      open: true,
      renderPanel,
      resetKey: "thread-2",
    });
    realizeDrawerPanel(unmountFrames);
    scheduleCompactDrawerSettleFrame();
    mounted.unmount();

    expect(unmountFrames.cancelAnimationFrame).toHaveBeenCalledWith(3);
    expect(dispatchBrowserViewBoundsSyncSpy).not.toHaveBeenCalled();
  });
});
