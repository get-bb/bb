// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@/components/ui/hooks/use-compact-viewport.js";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";

type ThreadDetailSecondaryContentProps = ComponentProps<
  typeof ThreadDetailSecondaryContent
>;
type RenderBrowserDeck = NonNullable<
  ThreadDetailSecondaryContentProps["secondaryPanel"]["renderBrowserDeck"]
>;
type DrawerShellCallback = (open: boolean) => void;

const drawerShellState = vi.hoisted(() => ({
  onContentAnimationEnd: undefined as DrawerShellCallback | undefined,
}));

vi.mock("@/lib/browser-view-bounds-sync", () => ({
  dispatchBrowserViewBoundsSync: vi.fn(),
}));

vi.mock("@/lib/bb-desktop", () => ({
  getBbDesktopInfo: () => null,
  shouldUseMacosDesktopChrome: () => false,
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  useOptionalIsSidebarShowing: () => true,
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreads: () => ({ data: [] }),
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => 50,
}));

vi.mock("react-resizable-panels", async () => {
  const React = await import("react");

  const PanelGroup = React.forwardRef<
    { setLayout: (layout: number[]) => void },
    { children?: ReactNode }
  >(({ children }, ref) => {
    React.useImperativeHandle(ref, () => ({ setLayout: () => {} }), []);
    return React.createElement(
      "div",
      { "data-testid": "panel-group" },
      children,
    );
  });
  PanelGroup.displayName = "MockPanelGroup";

  const Panel = ({ children }: { children?: ReactNode }) =>
    React.createElement("div", { "data-testid": "panel" }, children);

  return { Panel, PanelGroup };
});

vi.mock("@/components/ui/responsive-overlay.js", async () => {
  const React = await import("react");

  const ResponsiveDrawerShell = ({
    children,
    onContentAnimationEnd,
    open,
  }: {
    children?: ReactNode;
    onContentAnimationEnd?: DrawerShellCallback;
    open: boolean;
  }) => {
    drawerShellState.onContentAnimationEnd = onContentAnimationEnd;
    return React.createElement(
      "div",
      {
        "data-open": String(open),
        "data-testid": "responsive-drawer-shell",
      },
      children,
    );
  };

  return { ResponsiveDrawerShell };
});

vi.mock("@/components/secondary-panel/ThreadMetadataContent", async (importOriginal) => {
  const React = await import("react");
  const actual =
    await importOriginal<
      typeof import("@/components/secondary-panel/ThreadMetadataContent")
    >();

  return {
    ...actual,
    ThreadMetadataCard: ({
      children,
    }: ComponentProps<typeof actual.ThreadMetadataCard>) =>
      React.createElement("div", { "data-testid": "metadata-card" }, children),
    ThreadMetadataContent: (
      _props: ComponentProps<typeof actual.ThreadMetadataContent>,
    ) =>
      React.createElement("div", { "data-testid": "metadata-content" }),
    hasAnyThreadMetadata: () => false,
  };
});

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", async (importOriginal) => {
  const React = await import("react");
  const actual =
    await importOriginal<
      typeof import("@/components/secondary-panel/ThreadSecondaryPanel")
    >();

  const ThreadSecondaryPanel = ({
    browserDeck,
    isOpen,
    renderAsDrawer,
  }: ComponentProps<typeof actual.ThreadSecondaryPanel>) =>
    React.createElement(
      "section",
      {
        "data-open": String(isOpen),
        "data-testid": renderAsDrawer
          ? "drawer-secondary-panel"
          : "inline-secondary-panel",
      },
      browserDeck,
    );

  return { ...actual, ThreadSecondaryPanel };
});

vi.mock("@/components/secondary-panel/ConversationCollapsedRail", async () => {
  const React = await import("react");

  const ConversationCollapsedRail = () =>
    React.createElement("div", {
      "data-testid": "conversation-collapsed-rail",
    });

  return { ConversationCollapsedRail };
});

vi.mock("./ThreadTimelinePane", async (importOriginal) => {
  const React = await import("react");
  const actual =
    await importOriginal<typeof import("./ThreadTimelinePane")>();

  const ThreadTimelinePane = ({
    threadId,
  }: ComponentProps<typeof actual.ThreadTimelinePane>) =>
    React.createElement("div", {
      "data-testid": "thread-timeline-pane",
      "data-thread-id": threadId,
    });

  return { ...actual, ThreadTimelinePane };
});

interface QueuedAnimationFrames {
  cancelAnimationFrame: ReturnType<typeof vi.spyOn>;
  flushAll: () => void;
  requestAnimationFrame: ReturnType<typeof vi.spyOn>;
  size: () => number;
}

interface RenderThreadDetailArgs {
  isCompactViewport: boolean;
  isSecondaryPanelOpen: boolean;
  renderBrowserDeck: RenderBrowserDeck;
  threadId: string;
}

const noop = () => {};

function installAnimationFrameQueue(order?: string[]): QueuedAnimationFrames {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;

  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: noop,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
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
      const pendingCallbacks = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pendingCallbacks) {
        callback(performance.now());
      }
    },
    requestAnimationFrame,
    size: () => callbacks.size,
  };
}

function makeThread(
  threadId: string,
): ThreadDetailSecondaryContentProps["metadata"]["thread"] {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 0,
    deletedAt: null,
    environmentId: null,
    id: threadId,
    lastReadAt: null,
    latestAttentionAt: 0,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj-test",
    providerId: "codex",
    sourceThreadId: null,
    originKind: null,
    childOrigin: null,
    status: "idle",
    stopRequestedAt: null,
    title: null,
    titleFallback: "Test thread",
    updatedAt: 0,
  } as ThreadDetailSecondaryContentProps["metadata"]["thread"];
}

function createBrowserDeckRenderer(order?: string[]): RenderBrowserDeck {
  return vi.fn(({ canShowNativeBrowserView }) => {
    order?.push(`render:${String(canShowNativeBrowserView)}`);
    return (
      <div
        data-can-show-native-browser-view={String(canShowNativeBrowserView)}
        data-testid="browser-deck"
      />
    );
  });
}

function createProps({
  isSecondaryPanelOpen,
  renderBrowserDeck,
  threadId,
}: Omit<
  RenderThreadDetailArgs,
  "isCompactViewport"
>): ThreadDetailSecondaryContentProps {
  return {
    footer: <div data-testid="footer" />,
    header: <div data-testid="header" />,
    isConversationCollapsed: false,
    isMetadataLoading: false,
    isSecondaryPanelOpen,
    metadata: {
      canAssignToParent: false,
      canTakeOverThread: false,
      environment: null,
      environmentDisplayHost: { locality: "local" },
      isLoadingMergeBaseBranchOptions: false,
      mergeBaseBranchOptions: undefined,
      onAssignParent: noop,
      onMergeBaseBranchChange: noop,
      parentThreadDisplayName: null,
      parentThreads: [],
      projectId: "proj-test",
      pullRequest: null,
      selectedMergeBaseBranch: undefined,
      thread: makeThread(threadId),
      threadSchedules: [],
      updateThreadPending: false,
      workspaceStatus: undefined,
      workspaceStatusError: null,
    } as ThreadDetailSecondaryContentProps["metadata"],
    onToggleConversationCollapse: noop,
    secondaryPanel: {
      activeTab: null,
      canUseGitUi: false,
      fileTabs: [],
      isBrowserTabActive: true,
      isOpen: isSecondaryPanelOpen,
      onCollapse: noop,
      onClose: noop,
      onFileTabReorder: noop,
      onOpenNewTab: noop,
      onPanelChange: noop,
      onPanelFocus: noop,
      renderBrowserDeck,
      showGitDiffTab: false,
    },
    surface: "page",
    timeline: {
      activeThinking: null,
      hasOlderTimelineRows: false,
      isLoadingOlderTimelineRows: false,
      isThreadTimelinePending: false,
      onLoadOlderRows: noop,
      resolveMentionLink: () => null,
      showOngoingIndicator: false,
      stopRequestedAt: null,
      threadId,
      threadRuntimeDisplayStatus: "idle",
      timelineError: false,
      timelineRows: [],
      unreadDividerAutoScroll: false,
      unreadDividerPlacement: null,
      workspaceRootPath: undefined,
    } as unknown as ThreadDetailSecondaryContentProps["timeline"],
  };
}

function renderThreadDetail(args: RenderThreadDetailArgs) {
  let renderArgs = args;
  const view = render(
    <CompactViewportOverrideProvider
      isCompactViewport={renderArgs.isCompactViewport}
    >
      <ThreadDetailSecondaryContent
        {...createProps({
          isSecondaryPanelOpen: renderArgs.isSecondaryPanelOpen,
          renderBrowserDeck: renderArgs.renderBrowserDeck,
          threadId: renderArgs.threadId,
        })}
      />
    </CompactViewportOverrideProvider>,
  );

  return {
    ...view,
    rerenderWith(nextArgs: Partial<RenderThreadDetailArgs>) {
      renderArgs = { ...renderArgs, ...nextArgs };
      view.rerender(
        <CompactViewportOverrideProvider
          isCompactViewport={renderArgs.isCompactViewport}
        >
          <ThreadDetailSecondaryContent
            {...createProps({
              isSecondaryPanelOpen: renderArgs.isSecondaryPanelOpen,
              renderBrowserDeck: renderArgs.renderBrowserDeck,
              threadId: renderArgs.threadId,
            })}
          />
        </CompactViewportOverrideProvider>,
      );
    },
  };
}

function expectBrowserDeckVisibility(canShowNativeBrowserView: boolean) {
  expect(
    screen
      .getByTestId("browser-deck")
      .getAttribute("data-can-show-native-browser-view"),
  ).toBe(String(canShowNativeBrowserView));
}

function scheduleCompactDrawerSettleFrame() {
  const callback = drawerShellState.onContentAnimationEnd;
  if (callback === undefined) {
    throw new Error("ResponsiveDrawerShell did not receive animation callback");
  }
  act(() => {
    callback(true);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  drawerShellState.onContentAnimationEnd = undefined;
});

beforeEach(() => {
  vi.mocked(dispatchBrowserViewBoundsSync).mockReset();
});

describe("ThreadDetailSecondaryContent compact drawer settling", () => {
  it("orders open-animation completion, rAF, bounds sync, and drawer settled true", () => {
    const order: string[] = [];
    const frames = installAnimationFrameQueue(order);
    vi.mocked(dispatchBrowserViewBoundsSync).mockImplementation(() => {
      order.push("dispatchBrowserViewBoundsSync");
    });
    const renderBrowserDeck = createBrowserDeckRenderer(order);

    renderThreadDetail({
      isCompactViewport: true,
      isSecondaryPanelOpen: true,
      renderBrowserDeck,
      threadId: "thread-1",
    });

    expectBrowserDeckVisibility(false);

    order.push("animationEnd:true");
    scheduleCompactDrawerSettleFrame();

    expect(frames.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(dispatchBrowserViewBoundsSync).not.toHaveBeenCalled();
    expectBrowserDeckVisibility(false);

    act(() => {
      frames.flushAll();
    });

    expectBrowserDeckVisibility(true);
    expect(order).toEqual([
      "render:false",
      "animationEnd:true",
      "requestAnimationFrame",
      "dispatchBrowserViewBoundsSync",
      "render:true",
    ]);
  });

  it("ignores close-animation completion without dispatching bounds sync", () => {
    const frames = installAnimationFrameQueue();
    const renderBrowserDeck = createBrowserDeckRenderer();

    renderThreadDetail({
      isCompactViewport: true,
      isSecondaryPanelOpen: true,
      renderBrowserDeck,
      threadId: "thread-1",
    });

    const callback = drawerShellState.onContentAnimationEnd;
    if (callback === undefined) {
      throw new Error(
        "ResponsiveDrawerShell did not receive animation callback",
      );
    }

    act(() => {
      callback(false);
    });

    expect(frames.requestAnimationFrame).not.toHaveBeenCalled();
    expect(dispatchBrowserViewBoundsSync).not.toHaveBeenCalled();
    expectBrowserDeckVisibility(false);
  });

  it("does not schedule a stale open callback after the compact drawer closes", () => {
    const frames = installAnimationFrameQueue();
    const renderBrowserDeck = createBrowserDeckRenderer();
    const view = renderThreadDetail({
      isCompactViewport: true,
      isSecondaryPanelOpen: true,
      renderBrowserDeck,
      threadId: "thread-1",
    });

    view.rerenderWith({ isSecondaryPanelOpen: false });
    scheduleCompactDrawerSettleFrame();

    expect(frames.requestAnimationFrame).not.toHaveBeenCalled();
    expect(dispatchBrowserViewBoundsSync).not.toHaveBeenCalled();
    expectBrowserDeckVisibility(false);
  });

  it("cancels a pending compact drawer settle rAF when the drawer closes", () => {
    const frames = installAnimationFrameQueue();
    const renderBrowserDeck = createBrowserDeckRenderer();
    const view = renderThreadDetail({
      isCompactViewport: true,
      isSecondaryPanelOpen: true,
      renderBrowserDeck,
      threadId: "thread-1",
    });

    scheduleCompactDrawerSettleFrame();
    expect(frames.size()).toBe(1);

    view.rerenderWith({ isSecondaryPanelOpen: false });
    expect(frames.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frames.cancelAnimationFrame).toHaveBeenCalledWith(1);

    act(() => {
      frames.flushAll();
    });

    expect(dispatchBrowserViewBoundsSync).not.toHaveBeenCalled();
    expectBrowserDeckVisibility(false);
  });

  it("cancels a pending compact drawer settle rAF when the thread changes", () => {
    const frames = installAnimationFrameQueue();
    const renderBrowserDeck = createBrowserDeckRenderer();
    const view = renderThreadDetail({
      isCompactViewport: true,
      isSecondaryPanelOpen: true,
      renderBrowserDeck,
      threadId: "thread-1",
    });

    scheduleCompactDrawerSettleFrame();
    expect(frames.size()).toBe(1);

    view.rerenderWith({ threadId: "thread-2" });
    expect(frames.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frames.cancelAnimationFrame).toHaveBeenCalledWith(1);

    act(() => {
      frames.flushAll();
    });

    expect(dispatchBrowserViewBoundsSync).not.toHaveBeenCalled();
    expectBrowserDeckVisibility(false);
  });

  it("cancels a pending compact drawer settle rAF on compact-to-wide transition", () => {
    const frames = installAnimationFrameQueue();
    const renderBrowserDeck = createBrowserDeckRenderer();
    const view = renderThreadDetail({
      isCompactViewport: true,
      isSecondaryPanelOpen: true,
      renderBrowserDeck,
      threadId: "thread-1",
    });

    scheduleCompactDrawerSettleFrame();
    expect(frames.size()).toBe(1);

    view.rerenderWith({ isCompactViewport: false });
    expect(frames.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frames.cancelAnimationFrame).toHaveBeenCalledWith(1);

    act(() => {
      frames.flushAll();
    });

    expect(dispatchBrowserViewBoundsSync).not.toHaveBeenCalled();
    expectBrowserDeckVisibility(true);
  });

  it("cancels a pending compact drawer settle rAF on unmount", () => {
    const frames = installAnimationFrameQueue();
    const renderBrowserDeck = createBrowserDeckRenderer();
    const view = renderThreadDetail({
      isCompactViewport: true,
      isSecondaryPanelOpen: true,
      renderBrowserDeck,
      threadId: "thread-1",
    });

    scheduleCompactDrawerSettleFrame();
    expect(frames.size()).toBe(1);

    view.unmount();
    expect(frames.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(frames.cancelAnimationFrame).toHaveBeenCalledWith(1);

    act(() => {
      frames.flushAll();
    });

    expect(dispatchBrowserViewBoundsSync).not.toHaveBeenCalled();
  });

  it("passes compact opening and wide layout visibility values to the browser deck render prop", () => {
    const frames = installAnimationFrameQueue();
    vi.mocked(dispatchBrowserViewBoundsSync).mockImplementation(() => {});
    const compactRenderBrowserDeck = createBrowserDeckRenderer();

    renderThreadDetail({
      isCompactViewport: true,
      isSecondaryPanelOpen: true,
      renderBrowserDeck: compactRenderBrowserDeck,
      threadId: "thread-1",
    });

    expect(compactRenderBrowserDeck).toHaveBeenLastCalledWith({
      canShowNativeBrowserView: false,
    });
    scheduleCompactDrawerSettleFrame();
    act(() => {
      frames.flushAll();
    });
    expect(compactRenderBrowserDeck).toHaveBeenLastCalledWith({
      canShowNativeBrowserView: true,
    });

    cleanup();

    const wideRenderBrowserDeck = createBrowserDeckRenderer();
    const wideView = renderThreadDetail({
      isCompactViewport: false,
      isSecondaryPanelOpen: false,
      renderBrowserDeck: wideRenderBrowserDeck,
      threadId: "thread-1",
    });

    expect(wideRenderBrowserDeck).toHaveBeenLastCalledWith({
      canShowNativeBrowserView: false,
    });

    wideView.rerenderWith({ isSecondaryPanelOpen: true });

    expect(wideRenderBrowserDeck).toHaveBeenLastCalledWith({
      canShowNativeBrowserView: true,
    });
    expect(dispatchBrowserViewBoundsSync).toHaveBeenCalledTimes(1);
  });
});
