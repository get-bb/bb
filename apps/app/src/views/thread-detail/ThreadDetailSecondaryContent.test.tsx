// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  forwardRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Thread } from "@bb/domain";
import type { TimelineTurnRow } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";

interface MockPanelGroupProps {
  children: ReactNode;
}

type MockPanelResizeHandler = (size: number) => void;
type MockPanelDraggingHandler = (isDragging: boolean) => void;
type TerminalPanelResizeHandler = (sizePercent: number) => void;

interface MockPanelProps {
  children: ReactNode;
  id?: string;
  defaultSize?: number;
  onResize?: MockPanelResizeHandler;
}

interface MockPanelResizeHandleProps {
  children?: ReactNode;
  disabled?: boolean;
  onDragging?: MockPanelDraggingHandler;
}

interface MockThreadMetadataCardProps {
  children: ReactNode;
}

interface MockThreadTimelinePaneProps {
  footer: ReactNode;
  header: ReactNode;
}

interface MockThreadSecondaryPanelProps {
  isOpen: boolean;
  isConversationCollapsed: boolean;
  reserveLeftForDesktopTrafficLights: boolean;
}

interface MockConversationCollapsedRailProps {
  collapsed: boolean;
  reserveTopForDesktopTrafficLights: boolean;
  onExpand: () => void;
}

const { sidebarShowingRef, desktopChromeRef } = vi.hoisted(() => ({
  sidebarShowingRef: { current: true },
  desktopChromeRef: { current: false },
}));

vi.mock("react-resizable-panels", () => ({
  // forwardRef so the real horizontal-group ref attaches without a warning;
  // the ref intentionally stays null so the collapse layout effect no-ops in
  // tests and the visible state comes purely from rendered props.
  PanelGroup: forwardRef<HTMLDivElement, MockPanelGroupProps>(
    function PanelGroup({ children }, _ref) {
      return <div>{children}</div>;
    },
  ),
  Panel({ children, id, defaultSize, onResize }: MockPanelProps) {
    return (
      <section aria-label={id} data-default-size={defaultSize}>
        {onResize ? (
          <button
            type="button"
            onClick={() => onResize(45)}
            aria-label={`Resize ${id} to 45`}
          />
        ) : null}
        {children}
      </section>
    );
  },
  PanelResizeHandle({
    children,
    disabled,
    onDragging,
  }: MockPanelResizeHandleProps) {
    return (
      <div aria-disabled={disabled}>
        <button
          type="button"
          onClick={() => onDragging?.(true)}
          aria-label="Start terminal panel drag"
        />
        <button
          type="button"
          onClick={() => onDragging?.(false)}
          aria-label="End terminal panel drag"
        />
        {children}
      </div>
    );
  },
}));

vi.mock("@/components/ui/hooks/use-compact-viewport.js", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("@/components/ui/sidebar.js", () => ({
  // The host tests don't mount a SidebarProvider. Backed by a hoisted ref so
  // individual cases can flip the sidebar-collapsed signal that gates the
  // traffic-light reserve.
  useIsSidebarShowing: () => sidebarShowingRef.current,
}));

vi.mock("@/lib/bb-desktop", async () => {
  // Preserve the real token exports (the unmocked ConversationCollapsedRail
  // reads MACOS_TRAFFIC_LIGHT_RESERVE_TOP_CLASS from this module); only swap
  // the desktop-chrome gate so cases can pick web vs macOS desktop.
  const actual =
    await vi.importActual<typeof import("@/lib/bb-desktop")>(
      "@/lib/bb-desktop",
    );
  return {
    ...actual,
    getBbDesktopInfo: () => null,
    shouldUseMacosDesktopChrome: () => desktopChromeRef.current,
  };
});

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", () => ({
  // Surfacing the traffic-light reserve prop as a data attribute is what
  // makes the parent gate (desktop + sidebar collapsed + conversation
  // collapsed) actually testable from this seam.
  ThreadSecondaryPanel({
    isOpen,
    isConversationCollapsed,
    reserveLeftForDesktopTrafficLights,
  }: MockThreadSecondaryPanelProps) {
    return (
      <aside
        data-testid="mock-secondary-panel"
        data-secondary-panel-open={isOpen}
        data-secondary-panel-conversation-collapsed={isConversationCollapsed}
        data-secondary-panel-reserve-left={String(
          reserveLeftForDesktopTrafficLights,
        )}
      >
        Secondary panel
      </aside>
    );
  },
}));

vi.mock("@/components/secondary-panel/ConversationCollapsedRail", () => ({
  // Same shape as the secondary-panel mock: the rail's reserveTop prop is
  // the other half of the parent gate, so it has to be observable here.
  ConversationCollapsedRail({
    collapsed,
    reserveTopForDesktopTrafficLights,
    onExpand,
  }: MockConversationCollapsedRailProps) {
    return (
      <button
        type="button"
        data-testid="mock-conversation-collapsed-rail"
        data-rail-collapsed={String(collapsed)}
        data-rail-reserve-top={String(reserveTopForDesktopTrafficLights)}
        aria-label="Expand conversation"
        aria-expanded={collapsed ? "false" : "true"}
        // Mirror the real rail: when the conversation is shown, the rail
        // disappears from the a11y tree + tab order. Existing tests rely on
        // this to assert that the expand affordance is gone post-click.
        aria-hidden={collapsed ? undefined : true}
        inert={collapsed ? undefined : true}
        onClick={onExpand}
      >
        <span data-icon="MessageSquare" aria-hidden="true" />
      </button>
    );
  },
}));

vi.mock("@/components/secondary-panel/ThreadMetadataContent", () => ({
  ThreadMetadataCard({ children }: MockThreadMetadataCardProps) {
    return <div>{children}</div>;
  },
  ThreadMetadataContent() {
    return <div>Thread metadata</div>;
  },
  hasAnyThreadMetadata: () => false,
}));

vi.mock("./ThreadTimelinePane", () => ({
  ThreadTimelinePane({ footer, header }: MockThreadTimelinePaneProps) {
    return (
      <main>
        {header}
        Timeline
        {footer}
      </main>
    );
  },
}));

const noop = () => {};

function noopAssignManager(_parentThreadId: string | null): void {}

function noopBranchChange(_branch: string): void {}

function noopSecondaryPanelChange(_panel: ThreadSecondaryPanelTab): void {}

function noopOpenFile(_path: string): void {}

function noopLoadTurnSummaryRows(_entry: TimelineTurnRow): void {}

function makeThread(): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    automationId: null,
    providerId: "openai",
    type: "standard",
    title: "Test thread",
    titleFallback: null,
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

interface SecondaryContentOverrides {
  onTerminalPanelResize?: TerminalPanelResizeHandler;
  isSecondaryPanelOpen?: boolean;
  isConversationCollapsed?: boolean;
  onToggleConversationCollapse?: () => void;
}

function buildSecondaryContentProps({
  onTerminalPanelResize = noop,
  isSecondaryPanelOpen = false,
  isConversationCollapsed = false,
  onToggleConversationCollapse = noop,
}: SecondaryContentOverrides = {}): ComponentProps<
  typeof ThreadDetailSecondaryContent
> {
  return {
    footer: <div>Footer</div>,
    header: <div>Header</div>,
    isMetadataLoading: false,
    isSecondaryPanelOpen,
    isConversationCollapsed,
    onToggleConversationCollapse,
    metadata: {
      thread: makeThread(),
      projectId: "proj_test",
      parentThreadDisplayName: null,
      managerThreads: [],
      canAssignToManager: false,
      canTakeOverThread: false,
      environmentHost: null,
      environmentIsLocal: true,
      environment: null,
      workspaceStatus: undefined,
      workspaceStatusError: null,
      selectedMergeBaseBranch: undefined,
      mergeBaseBranchOptions: undefined,
      isLoadingMergeBaseBranchOptions: false,
      updateThreadPending: false,
      onAssignManager: noopAssignManager,
      onMergeBaseBranchChange: noopBranchChange,
    },
    secondaryPanel: {
      activePanel: null,
      canUseGitUi: false,
      defaultMergeBaseBranch: undefined,
      environmentId: undefined,
      fileTabs: undefined,
      fileTabContent: undefined,
      isOpen: isSecondaryPanelOpen,
      showGitDiffTab: false,
      workspaceRootPath: undefined,
      onClose: noop,
      onCollapse: noop,
      onOpenFileInEditor: noopOpenFile,
      onOpenFilePreview: noopOpenFile,
      onOpenNewTab: noop,
      onPanelChange: noopSecondaryPanelChange,
      onPanelFocus: noop,
    },
    terminalPanel: <div>Terminal</div>,
    terminalPanelHeightPercent: 32,
    terminalPanelOpen: true,
    onTerminalPanelResize,
    timeline: {
      activeThinking: null,
      hasOlderTimelineRows: false,
      hostConnectionNotice: null,
      isLoadingOlderTimelineRows: false,
      isThreadTimelinePending: false,
      timelineError: false,
      loadingTurnSummaryIds: new Set<string>(),
      erroredTurnSummaryIds: new Set<string>(),
      onLoadOlderRows: noop,
      onLoadTurnSummaryRows: noopLoadTurnSummaryRows,
      projectId: "proj_test",
      showOngoingIndicator: false,
      stopRequestedAt: null,
      timelineRows: [],
      threadId: "thr_test",
      threadRuntimeDisplayStatus: "idle",
      turnSummaryRowsIdentity: "empty",
      turnSummaryRowsById: {},
      unreadDividerAutoScroll: false,
      unreadDividerPlacement: null,
      workspaceRootPath: undefined,
    },
  };
}

function renderContent(onTerminalPanelResize: TerminalPanelResizeHandler) {
  return render(
    <ThreadDetailSecondaryContent
      {...buildSecondaryContentProps({ onTerminalPanelResize })}
    />,
  );
}

const TIMELINE_PANEL_LABEL = "thread-detail-timeline-panel";

function getTimelinePanel(): HTMLElement {
  return screen.getByRole("region", { name: TIMELINE_PANEL_LABEL });
}

function getConversationPane(container: HTMLElement): HTMLElement {
  const pane = container.querySelector<HTMLElement>(
    "[data-conversation-collapsed]",
  );
  if (pane === null) {
    throw new Error("Conversation pane wrapper not found");
  }
  return pane;
}

function ConversationCollapseHarness({
  initialCollapsed,
  isSecondaryPanelOpen,
}: {
  initialCollapsed: boolean;
  isSecondaryPanelOpen: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <ThreadDetailSecondaryContent
      {...buildSecondaryContentProps({
        isSecondaryPanelOpen,
        isConversationCollapsed: collapsed,
        onToggleConversationCollapse: () => setCollapsed((current) => !current),
      })}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sidebarShowingRef.current = true;
  desktopChromeRef.current = false;
});

describe("ThreadDetailSecondaryContent", () => {
  it("persists terminal size immediately outside an active drag", () => {
    const onTerminalPanelResize = vi.fn();
    renderContent(onTerminalPanelResize);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Resize thread-detail-terminal-panel to 45",
      }),
    );

    expect(onTerminalPanelResize).toHaveBeenCalledTimes(1);
    expect(onTerminalPanelResize).toHaveBeenCalledWith(45);
  });

  it("defers terminal size persistence until drag end", () => {
    const onTerminalPanelResize = vi.fn();
    renderContent(onTerminalPanelResize);

    fireEvent.click(
      screen.getByRole("button", { name: "Start terminal panel drag" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Resize thread-detail-terminal-panel to 45",
      }),
    );

    expect(onTerminalPanelResize).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "End terminal panel drag" }),
    );

    expect(onTerminalPanelResize).toHaveBeenCalledTimes(1);
    expect(onTerminalPanelResize).toHaveBeenCalledWith(45);
  });
});

describe("ThreadDetailSecondaryContent conversation collapse", () => {
  it("mounts the timeline at zero width and hides it when collapsed with the panel open", () => {
    const { container } = render(
      <ThreadDetailSecondaryContent
        {...buildSecondaryContentProps({
          isSecondaryPanelOpen: true,
          isConversationCollapsed: true,
        })}
      />,
    );

    expect(getTimelinePanel().getAttribute("data-default-size")).toBe("0");
    const pane = getConversationPane(container);
    expect(pane.getAttribute("data-conversation-collapsed")).toBe("true");
    // `inert` keeps the hidden conversation out of the tab order + a11y tree.
    expect(pane.hasAttribute("inert")).toBe(true);
  });

  it("renders the slim conversation rail with its chat glyph when collapsed", () => {
    render(
      <ThreadDetailSecondaryContent
        {...buildSecondaryContentProps({
          isSecondaryPanelOpen: true,
          isConversationCollapsed: true,
        })}
      />,
    );

    const rail = screen.getByRole("button", { name: "Expand conversation" });
    expect(rail.getAttribute("aria-expanded")).toBe("false");
    // The MessageSquare glyph stands in for the tucked-away conversation.
    expect(rail.querySelector("[data-icon='MessageSquare']")).not.toBeNull();
  });

  it("expands the conversation when the rail is clicked", () => {
    const { container } = render(
      <ConversationCollapseHarness initialCollapsed isSecondaryPanelOpen />,
    );

    expect(getConversationPane(container).hasAttribute("inert")).toBe(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Expand conversation" }),
    );

    const pane = getConversationPane(container);
    expect(pane.getAttribute("data-conversation-collapsed")).toBe("false");
    expect(pane.hasAttribute("inert")).toBe(false);
    // Once the conversation is shown again, the rail drops out of the a11y tree.
    expect(
      screen.queryByRole("button", { name: "Expand conversation" }),
    ).toBeNull();
  });

  it("does not collapse and offers no toggle while the secondary panel is closed", () => {
    const { container } = render(
      <ThreadDetailSecondaryContent
        {...buildSecondaryContentProps({
          isSecondaryPanelOpen: false,
          isConversationCollapsed: true,
        })}
      />,
    );

    // Preference is ignored: the conversation stays visible and full width.
    const pane = getConversationPane(container);
    expect(pane.getAttribute("data-conversation-collapsed")).toBe("false");
    expect(pane.hasAttribute("inert")).toBe(false);
    expect(getTimelinePanel().getAttribute("data-default-size")).toBe("100");
    expect(screen.queryByRole("button", { name: /conversation/i })).toBeNull();
  });
});

interface DesktopTrafficLightScenarioState {
  desktopChrome: boolean;
  sidebarShowing: boolean;
  conversationCollapsed: boolean;
}

interface DesktopTrafficLightExpectation {
  railReserveTop: boolean;
  panelReserveLeft: boolean;
}

interface DesktopTrafficLightScenario {
  name: string;
  state: DesktopTrafficLightScenarioState;
  expected: DesktopTrafficLightExpectation;
}

function renderForTrafficLightCase(
  state: DesktopTrafficLightScenarioState,
): { rail: HTMLElement; panel: HTMLElement } {
  desktopChromeRef.current = state.desktopChrome;
  sidebarShowingRef.current = state.sidebarShowing;
  render(
    <ThreadDetailSecondaryContent
      {...buildSecondaryContentProps({
        isSecondaryPanelOpen: true,
        isConversationCollapsed: state.conversationCollapsed,
      })}
    />,
  );
  return {
    rail: screen.getByTestId("mock-conversation-collapsed-rail"),
    panel: screen.getByTestId("mock-secondary-panel"),
  };
}

describe("ThreadDetailSecondaryContent desktop traffic-light reserve", () => {
  // Drives the actual gate that decides whether each leaf gets its reserve.
  // Each case exercises one corner of (desktop chrome × sidebar shown ×
  // conversation collapsed) so the test would fail if the gate were widened
  // (e.g. firing on web, or with the sidebar still covering the lights).
  it.each<DesktopTrafficLightScenario>([
    {
      name: "macOS desktop + sidebar collapsed + conversation collapsed → both reserves on",
      state: {
        desktopChrome: true,
        sidebarShowing: false,
        conversationCollapsed: true,
      },
      expected: { railReserveTop: true, panelReserveLeft: true },
    },
    {
      name: "macOS desktop + sidebar collapsed + conversation shown → only the rail reserve (panel is no longer leftmost)",
      state: {
        desktopChrome: true,
        sidebarShowing: false,
        conversationCollapsed: false,
      },
      expected: { railReserveTop: true, panelReserveLeft: false },
    },
    {
      name: "macOS desktop + sidebar expanded → neither reserve (sidebar already covers the lights)",
      state: {
        desktopChrome: true,
        sidebarShowing: true,
        conversationCollapsed: true,
      },
      expected: { railReserveTop: false, panelReserveLeft: false },
    },
    {
      name: "web (non-macOS) + sidebar collapsed + conversation collapsed → neither reserve (no traffic lights to clear)",
      state: {
        desktopChrome: false,
        sidebarShowing: false,
        conversationCollapsed: true,
      },
      expected: { railReserveTop: false, panelReserveLeft: false },
    },
  ])("$name", ({ state, expected }) => {
    const { rail, panel } = renderForTrafficLightCase(state);
    expect(rail.getAttribute("data-rail-reserve-top")).toBe(
      String(expected.railReserveTop),
    );
    expect(panel.getAttribute("data-secondary-panel-reserve-left")).toBe(
      String(expected.panelReserveLeft),
    );
  });
});
