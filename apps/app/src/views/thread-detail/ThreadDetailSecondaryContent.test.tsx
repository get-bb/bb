// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
  onToggleConversationCollapse: () => void;
}

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

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", () => ({
  // Stand in for the real seam arrow: only rendered while the panel is open,
  // delegating to the collapse handler. A stable label keeps these host tests
  // (which assert inert/sizing/rail behavior, not arrow copy) unambiguous next
  // to the rail's "Expand conversation" button. The arrow's own dynamic copy is
  // covered by SeamPanelArrow.test.tsx and ThreadSecondaryPanel.test.tsx.
  ThreadSecondaryPanel({
    isOpen,
    isConversationCollapsed,
    onToggleConversationCollapse,
  }: MockThreadSecondaryPanelProps) {
    return (
      <aside>
        Secondary panel
        {isOpen ? (
          <button
            type="button"
            aria-label="Toggle conversation collapse"
            aria-expanded={!isConversationCollapsed}
            onClick={onToggleConversationCollapse}
          >
            Toggle conversation
          </button>
        ) : null}
      </aside>
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
  onToggleSecondaryPanel?: () => void;
}

function buildSecondaryContentProps({
  onTerminalPanelResize = noop,
  isSecondaryPanelOpen = false,
  isConversationCollapsed = false,
  onToggleConversationCollapse = noop,
  onToggleSecondaryPanel = noop,
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
    onToggleSecondaryPanel,
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

  it("toggling collapse hides the conversation and toggling back restores it", () => {
    const { container } = render(
      <ConversationCollapseHarness
        initialCollapsed={false}
        isSecondaryPanelOpen
      />,
    );

    const pane = getConversationPane(container);
    expect(pane.getAttribute("data-conversation-collapsed")).toBe("false");
    expect(pane.hasAttribute("inert")).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle conversation collapse" }),
    );

    expect(
      getConversationPane(container).getAttribute(
        "data-conversation-collapsed",
      ),
    ).toBe("true");
    expect(getConversationPane(container).hasAttribute("inert")).toBe(true);
    expect(getTimelinePanel().getAttribute("data-default-size")).toBe("0");

    fireEvent.click(
      screen.getByRole("button", { name: "Toggle conversation collapse" }),
    );

    expect(
      getConversationPane(container).getAttribute(
        "data-conversation-collapsed",
      ),
    ).toBe("false");
    expect(getConversationPane(container).hasAttribute("inert")).toBe(false);
  });

  it("renders the slim conversation rail with its vertical label when collapsed", () => {
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
    // The vertical "Conversation" label is the rail's signature element.
    expect(within(rail).getByText("Conversation")).not.toBeNull();
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
