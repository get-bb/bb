// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";
import {
  DefaultPaneContextProvider,
  PaneContext,
  type PaneContextValue,
  type PaneSecondaryPanelViewModel,
} from "./PaneContext";

type ThreadDetailSecondaryContentProps = ComponentProps<
  typeof ThreadDetailSecondaryContent
>;

vi.mock("@/lib/bb-desktop", () => ({
  DEFAULT_DESKTOP_WINDOW_STATE: { isFullScreen: false },
  getBbDesktopInfo: () => null,
  shouldReserveMacosTrafficLights: () => false,
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

vi.mock(
  "@/components/secondary-panel/ThreadMetadataContent",
  async (importOriginal) => {
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
        React.createElement(
          "div",
          { "data-testid": "metadata-card" },
          children,
        ),
      ThreadMetadataContent: (
        _props: ComponentProps<typeof actual.ThreadMetadataContent>,
      ) => React.createElement("div", { "data-testid": "metadata-content" }),
      hasAnyThreadMetadata: () => false,
    };
  },
);

vi.mock(
  "@/components/secondary-panel/ThreadSecondaryPanel",
  async (importOriginal) => {
    const React = await import("react");
    const actual =
      await importOriginal<
        typeof import("@/components/secondary-panel/ThreadSecondaryPanel")
      >();

    const ThreadSecondaryPanel = ({
      inlinePanelToggle,
      metadataContent,
      renderAsDrawer,
    }: ComponentProps<typeof actual.ThreadSecondaryPanel>) =>
      React.createElement(
        "section",
        {
          "data-inline-panel-toggle": inlinePanelToggle,
          "data-testid": renderAsDrawer
            ? "drawer-secondary-panel"
            : "inline-secondary-panel",
        },
        metadataContent,
      );

    return { ...actual, ThreadSecondaryPanel };
  },
);

vi.mock("./ThreadTimelinePane", async (importOriginal) => {
  const React = await import("react");
  const actual = await importOriginal<typeof import("./ThreadTimelinePane")>();

  const ThreadTimelinePane = ({
    footer,
    threadId,
  }: ComponentProps<typeof actual.ThreadTimelinePane>) =>
    React.createElement(
      "div",
      {
        "data-testid": "thread-timeline-pane",
        "data-thread-id": threadId,
      },
      footer,
    );

  return { ...actual, ThreadTimelinePane };
});

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

function makeThread(): ThreadDetailSecondaryContentProps["metadata"]["thread"] {
  return {
    archivedAt: null,
    createdAt: 0,
    deletedAt: null,
    environmentId: null,
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 0,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj-test",
    providerId: "codex",
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    status: "idle",
    stopRequestedAt: null,
    title: null,
    titleFallback: "Test thread",
    sectionId: null,
    updatedAt: 0,
  } as ThreadDetailSecondaryContentProps["metadata"]["thread"];
}

function createProps(
  isMetadataLoading = false,
  isConversationCollapsed = false,
): ThreadDetailSecondaryContentProps {
  return {
    footer: <div data-testid="footer" />,
    header: <div data-testid="header" />,
    isBoundedPane: false,
    isConversationCollapsed,
    isMetadataLoading,
    isSecondaryPanelOpen: true,
    metadata: {
      canAssignToParent: false,
      canTakeOverThread: false,
      environment: null,
      environmentDisplayHost: { locality: "local", identity: null },
      isLoadingMergeBaseBranchOptions: false,
      mergeBaseBranchOptions: undefined,
      onAssignParent: noop,
      onParentSelectorOpenChange: noop,
      onRetryParentThreads: noop,
      onMergeBaseBranchChange: noop,
      parentThreadDisplayName: null,
      parentThreads: [],
      isLoadingParentThreads: false,
      isParentThreadsError: false,
      projectId: "proj-test",
      pullRequest: null,
      selectedMergeBaseBranch: undefined,
      thread: makeThread(),
      threadSchedules: [],
      updateThreadPending: false,
      workspaceStatus: undefined,
      workspaceStatusError: null,
    } as ThreadDetailSecondaryContentProps["metadata"],
    onToggleConversationCollapse: noop,
    onToggleSecondaryPanel: noop,
    renderHostedPanel: (panel) => panel,
    secondaryPanel: {
      activeTab: null,
      canUseGitUi: false,
      fileTabs: [],
      isBrowserTabActive: true,
      isOpen: true,
      onCollapse: noop,
      onClose: noop,
      onFileTabReorder: noop,
      onOpenNewTab: noop,
      onPanelChange: noop,
      onPanelFocus: noop,
      renderBrowserDeck: () => null,
      showGitDiffTab: false,
    },
    timeline: {
      activeThinking: null,
      hasOlderTimelineRows: false,
      isLoadingOlderTimelineRows: false,
      isThreadTimelinePending: false,
      onLoadOlderRows: noop,
      resolveMentionLink: () => null,
      showOngoingIndicator: false,
      stopRequestedAt: null,
      threadId: "thread-1",
      threadRuntimeDisplayStatus: "idle",
      timelineError: false,
      timelineRows: [],
      unreadDividerAutoScroll: false,
      unreadDividerPlacement: null,
      workspaceRootPath: undefined,
    } as unknown as ThreadDetailSecondaryContentProps["timeline"],
  };
}

function renderThreadDetail(
  hosted: boolean,
  isMetadataLoading = false,
  isConversationCollapsed = false,
) {
  const content = (
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <ThreadDetailSecondaryContent
        {...createProps(isMetadataLoading, isConversationCollapsed)}
      />
    </CompactViewportOverrideProvider>
  );
  if (!hosted) {
    return render(
      <MemoryRouter>
        <DefaultPaneContextProvider>{content}</DefaultPaneContextProvider>
      </MemoryRouter>,
    );
  }

  const value: PaneContextValue = {
    paneId: "pane-test",
    isFocused: true,
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
  return render(
    <PaneContext.Provider value={value}>{content}</PaneContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  publishedHostedPanel = null;
});

describe("ThreadDetailSecondaryContent", () => {
  it("keeps the standalone panel hide control in the panel toolbar", () => {
    renderThreadDetail(false);

    expect(
      screen
        .getByTestId("inline-secondary-panel")
        .getAttribute("data-inline-panel-toggle"),
    ).toBe("button");
  });

  it("places the hosted panel hide control at the outer edge of its toolbar", () => {
    renderThreadDetail(true, false, true);

    expect(screen.getByTestId("header").closest("[inert]")).toBeNull();
    expect(
      screen.getByTestId("thread-timeline-pane").closest("[inert]"),
    ).not.toBeNull();
    if (publishedHostedPanel === null) {
      throw new Error("Expected the focused pane to publish its panel model");
    }
    expect(publishedHostedPanel).toMatchObject({
      contentKey: "thread-1",
      isMainCollapsed: true,
    });
    render(<>{publishedHostedPanel.panel}</>);
    expect(
      screen
        .getByTestId("inline-secondary-panel")
        .getAttribute("data-inline-panel-toggle"),
    ).toBe("button");
  });

  it("keeps the thread header inside the timeline column beside the panel", () => {
    renderThreadDetail(false);

    const timelinePanel = screen.getByTestId("panel");
    const sidePanel = screen.getByTestId("inline-secondary-panel");
    const panelGroup = screen.getByTestId("panel-group");
    expect(timelinePanel.contains(screen.getByTestId("header"))).toBe(true);
    expect(timelinePanel.contains(sidePanel)).toBe(false);
    expect(panelGroup.contains(timelinePanel)).toBe(true);
    expect(panelGroup.contains(sidePanel)).toBe(true);
    expect(timelinePanel.contains(screen.getByTestId("footer"))).toBe(true);
    expect(sidePanel.textContent).toContain("No thread details available.");
  });

  it("keeps the thread metadata loading presentation in the panel", () => {
    renderThreadDetail(false, true);

    expect(
      screen
        .getByTestId("inline-secondary-panel")
        .contains(screen.getByTestId("metadata-card")),
    ).toBe(true);
  });
});
