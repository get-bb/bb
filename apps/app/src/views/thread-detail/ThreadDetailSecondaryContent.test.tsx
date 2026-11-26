// @vitest-environment jsdom

import { useMemo, type ComponentProps, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  usePluginComposerHost,
  usePluginComposerHostDraft,
  usePublishPluginComposerHost,
  type PluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  getPromptDraftAccessor,
  usePromptDraftStorage,
} from "@/hooks/usePromptDraftStorage";
import type { ThreadSecondaryPanelProps } from "@/components/secondary-panel/ThreadSecondaryPanel";
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

const secondaryPanelMockState = vi.hoisted(() => ({
  renderBrowserDeck: undefined as
    | ((
        activeBrowserTabId: string,
        pane: {
          isFocused: boolean;
          isOpen: boolean;
          onFocusPane: () => void;
        },
      ) => ReactNode)
    | undefined,
}));

vi.mock("@/lib/bb-desktop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bb-desktop")>()),
  DEFAULT_DESKTOP_WINDOW_STATE: { isFullScreen: false },
  getBbDesktopInfo: () => null,
  shouldReserveMacosTrafficLights: () => false,
  shouldUseMacosDesktopChrome: () => false,
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  useOptionalIsSidebarShowing: () => true,
  useSidebarKeepsCollapsedRail: () => false,
  useIsSidebarFramed: () => false,
}));

vi.mock("jotai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("jotai")>()),
  useAtomValue: () => 50,
}));

vi.mock(
  "react-resizable-panels",
  () => import("@/test/react-resizable-panels-stub"),
);

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", async () => {
  const React = await import("react");
  return {
    ThreadSecondaryPanel: ({
      renderBrowserDeck,
      renderAsDrawer,
    }: ThreadSecondaryPanelProps) => {
      secondaryPanelMockState.renderBrowserDeck = renderBrowserDeck;
      return React.createElement("section", {
        "data-testid": renderAsDrawer
          ? "drawer-secondary-panel"
          : "inline-secondary-panel",
      });
    },
  };
});

vi.mock("@/components/secondary-panel/BrowserTabDeck", () => ({
  BrowserTabDeck: () => null,
}));
vi.mock("@/components/secondary-panel/FilePreview", () => ({
  FilePreview: () => null,
}));
vi.mock("@/components/secondary-panel/NewTabPage", () => ({
  NewTabPage: () => null,
}));
vi.mock("@/components/secondary-panel/ThreadSecondaryPanelTabContent", () => ({
  AttachmentFilePreviewTabContent: () => null,
  HostFilePreviewTabContent: () => null,
  HostScopedFilePreviewTabContent: () => null,
  ProjectFilePreviewTabContent: () => null,
  ThreadStorageFilePreviewTabContent: () => null,
  WorkspaceFilePreviewTabContent: () => null,
}));
vi.mock("@/components/thread/terminal/ThreadTerminalPanel", () => ({
  ThreadTerminalPanel: () => null,
}));

const { timelinePaneRenders } = vi.hoisted(() => ({
  timelinePaneRenders: vi.fn(),
}));

function TimelinePaneProbe({
  footer,
  threadId,
}: {
  footer: ReactNode;
  threadId: string;
}) {
  timelinePaneRenders();
  return (
    <div data-testid="thread-timeline-pane" data-thread-id={threadId}>
      {footer}
    </div>
  );
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

function FooterComposerHostPublisher({ threadId }: { threadId: string }) {
  const promptDraft = usePromptDraftStorage({
    kind: "thread",
    projectId: "proj-test",
    threadId,
  });
  const host = useMemo<PluginComposerHost>(
    () => ({
      scope: {
        kind: "thread",
        threadId,
        projectId: "proj_test",
        environmentId: null,
      },
      textEffectKey: promptDraft.storageKey,
      getCurrent: promptDraft.getCurrent,
      subscribeDraft: promptDraft.subscribe,
      setDraft: promptDraft.setDraft,
      focus: () => {},
    }),
    [
      promptDraft.getCurrent,
      promptDraft.setDraft,
      promptDraft.storageKey,
      promptDraft.subscribe,
      threadId,
    ],
  );
  usePublishPluginComposerHost(host);
  return <FooterComposerDraftProbe />;
}

function FooterComposerDraftProbe() {
  const draft = usePluginComposerHostDraft(usePluginComposerHost());
  return <div data-testid="footer-composer-draft">{draft?.text ?? ""}</div>;
}

function createProps(
  isConversationCollapsed = false,
): ThreadDetailSecondaryContentProps {
  return {
    header: <div data-testid="header" />,
    isBoundedPane: false,
    isConversationCollapsed,
    isSecondaryPanelOpen: true,
    main: (
      <TimelinePaneProbe
        footer={<div data-testid="footer" />}
        threadId="thread-1"
      />
    ),
    threadId: "thread-1",
    environment: null,
    onToggleConversationCollapse: noop,
    onToggleSecondaryPanel: noop,
    renderHostedPanel: (panel) => panel,
    secondaryPanel: {
      activeTab: null,
      tabs: [],
      fixedTabs: [],
      isOpen: true,
      onCollapse: noop,
      onClose: noop,
      onTabReorder: noop,
      onOpenNewTab: noop,
      onPanelFocus: noop,
      renderBrowserDeck: () => null,
    },
  };
}

function renderThreadDetail(hosted: boolean, isConversationCollapsed = false) {
  const content = (
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <ThreadDetailSecondaryContent {...createProps(isConversationCollapsed)} />
    </CompactViewportOverrideProvider>
  );
  if (!hosted) {
    return render(
      <MemoryRouter>
        <DefaultPaneContextProvider
          paneId="main"
          onRequestClose={null}
          navigateInPane={noop}
        >
          {content}
        </DefaultPaneContextProvider>
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
  secondaryPanelMockState.renderBrowserDeck = undefined;
  timelinePaneRenders.mockClear();
  window.localStorage.clear();
});

describe("ThreadDetailSecondaryContent", () => {
  it("publishes the hosted panel and keeps the header interactive while the main pane is collapsed", () => {
    renderThreadDetail(true, true);

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
  });

  it("keeps the thread header inside the timeline column beside the panel", async () => {
    renderThreadDetail(false);

    const sidePanel = await screen.findByTestId("inline-secondary-panel");
    const timelinePanel = screen.getByTestId("panel");
    const panelGroup = screen.getByTestId("panel-group");
    expect(timelinePanel.contains(screen.getByTestId("header"))).toBe(true);
    expect(timelinePanel.contains(sidePanel)).toBe(false);
    expect(panelGroup.contains(timelinePanel)).toBe(true);
    expect(panelGroup.contains(sidePanel)).toBe(true);
    expect(timelinePanel.contains(screen.getByTestId("footer"))).toBe(true);
  });

  it("pins a split browser pane to its tab and gates native commands by pane focus", async () => {
    const renderBrowserDeck = vi.fn(() => null);
    const props = createProps();
    props.secondaryPanel.renderBrowserDeck = renderBrowserDeck;

    render(
      <MemoryRouter>
        <DefaultPaneContextProvider
          paneId="main"
          onRequestClose={null}
          navigateInPane={noop}
        >
          <CompactViewportOverrideProvider isCompactViewport={false}>
            <ThreadDetailSecondaryContent {...props} />
          </CompactViewportOverrideProvider>
        </DefaultPaneContextProvider>
      </MemoryRouter>,
    );

    await screen.findByTestId("inline-secondary-panel");
    const panelBrowserDeck = secondaryPanelMockState.renderBrowserDeck;
    expect(panelBrowserDeck).toBeDefined();
    if (panelBrowserDeck === undefined) return;

    const onFocusPane = vi.fn();
    void panelBrowserDeck("browser-split", {
      isFocused: true,
      isOpen: true,
      onFocusPane,
    });
    expect(renderBrowserDeck).toHaveBeenLastCalledWith({
      activeBrowserTabId: "browser-split",
      canHandleBrowserCommands: true,
      canShowNativeBrowserView: true,
      onNativeFocus: onFocusPane,
    });

    void panelBrowserDeck("browser-split", {
      isFocused: false,
      isOpen: true,
      onFocusPane,
    });
    expect(renderBrowserDeck).toHaveBeenLastCalledWith({
      activeBrowserTabId: "browser-split",
      canHandleBrowserCommands: false,
      canShowNativeBrowserView: true,
      onNativeFocus: onFocusPane,
    });
  });

  it("keeps the panel subtree mounted when navigating between threads", async () => {
    const props = createProps();
    const { rerender } = render(
      <MemoryRouter>
        <DefaultPaneContextProvider
          paneId="main"
          onRequestClose={null}
          navigateInPane={noop}
        >
          <CompactViewportOverrideProvider isCompactViewport={false}>
            <ThreadDetailSecondaryContent {...props} />
          </CompactViewportOverrideProvider>
        </DefaultPaneContextProvider>
      </MemoryRouter>,
    );

    const sidePanel = await screen.findByTestId("inline-secondary-panel");
    const panelGroup = screen.getByTestId("panel-group");

    const nextProps = createProps();
    nextProps.main = (
      <TimelinePaneProbe
        footer={<div data-testid="footer" />}
        threadId="thread-2"
      />
    );
    nextProps.threadId = "thread-2";
    rerender(
      <MemoryRouter>
        <DefaultPaneContextProvider
          paneId="main"
          onRequestClose={null}
          navigateInPane={noop}
        >
          <CompactViewportOverrideProvider isCompactViewport={false}>
            <ThreadDetailSecondaryContent {...nextProps} />
          </CompactViewportOverrideProvider>
        </DefaultPaneContextProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("panel-group")).toBe(panelGroup);
    expect(screen.getByTestId("inline-secondary-panel")).toBe(sidePanel);
    expect(
      screen.getByTestId("thread-timeline-pane").getAttribute("data-thread-id"),
    ).toBe("thread-2");
  });

  it("does not re-render the timeline pane while the composer draft changes", async () => {
    const props = createProps();
    props.main = (
      <TimelinePaneProbe
        footer={<FooterComposerHostPublisher threadId="thread-1" />}
        threadId="thread-1"
      />
    );
    render(
      <MemoryRouter>
        <DefaultPaneContextProvider
          paneId="main"
          onRequestClose={null}
          navigateInPane={noop}
        >
          <CompactViewportOverrideProvider isCompactViewport={false}>
            <ThreadDetailSecondaryContent {...props} />
          </CompactViewportOverrideProvider>
        </DefaultPaneContextProvider>
      </MemoryRouter>,
    );

    await screen.findByTestId("inline-secondary-panel");
    expect(screen.getByTestId("footer-composer-draft").textContent).toBe("");
    const paneRendersAfterMount = timelinePaneRenders.mock.calls.length;

    const accessor = getPromptDraftAccessor({
      kind: "thread",
      projectId: "proj-test",
      threadId: "thread-1",
    });
    const typed = "why does typing hang";
    for (let index = 1; index <= typed.length; index += 1) {
      const text = typed.slice(0, index);
      act(() => {
        accessor.setDraft({ text, mentions: [], attachments: [] });
      });
      expect(screen.getByTestId("footer-composer-draft").textContent).toBe(
        text,
      );
    }

    expect(timelinePaneRenders.mock.calls.length).toBe(paneRendersAfterMount);
  });
});
