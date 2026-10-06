import { defineSplit, SplitLoadFailure } from "@/lib/define-split";
import {
  useEffect,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useAtomValue } from "jotai";
import { Panel } from "react-resizable-panels";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { PANEL_COLLAPSE_TRANSITION_CLASS } from "./panelTransitionTokens";
import {
  CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT,
  useSecondaryPanelMinimum,
} from "./secondaryPanelSizing";
import { secondaryPanelWidthPercentAtom } from "./threadSecondaryPanelAtoms";

type ThreadSecondaryPanelModule = typeof import("./ThreadSecondaryPanel");

export function SecondaryPanelContentSkeleton() {
  return (
    <div
      className="space-y-2 px-4 py-4"
      data-testid="secondary-panel-content-skeleton"
    >
      <Skeleton className="h-3 w-3/4 rounded-sm" />
      <Skeleton className="h-3 w-full rounded-sm" />
      <Skeleton className="h-3 w-5/6 rounded-sm" />
      <Skeleton className="h-3 w-2/3 rounded-sm" />
    </div>
  );
}

function FilePreviewLoading() {
  return (
    <div role="status" aria-label="Loading file preview">
      <SecondaryPanelContentSkeleton />
    </div>
  );
}

interface ThreadSecondaryPanelInlinePlaceholderProps {
  isOpen: boolean;
  isConversationCollapsed: boolean;
  resizablePanelId: string | undefined;
  children?: ReactNode;
}

function ThreadSecondaryPanelInlinePlaceholder({
  isOpen,
  isConversationCollapsed,
  resizablePanelId,
  children,
}: ThreadSecondaryPanelInlinePlaceholderProps) {
  const minimumSize = useSecondaryPanelMinimum();
  const persistedWidthPercent = useAtomValue(secondaryPanelWidthPercentAtom);
  return (
    <Panel
      id={resizablePanelId}
      collapsible
      collapsedSize={0}
      defaultSize={
        isOpen
          ? isConversationCollapsed
            ? CONVERSATION_COLLAPSED_PANEL_SIZE_PERCENT
            : persistedWidthPercent
          : 0
      }
      minSize={(1 - minimumSize.max) * 100}
      maxSize={isConversationCollapsed ? 100 : (1 - minimumSize.min) * 100}
      order={2}
      className={cn(
        "min-w-0 overflow-clip",
        `relative transition-[flex-grow,flex-basis] ${PANEL_COLLAPSE_TRANSITION_CLASS}`,
        isOpen && !isConversationCollapsed && "border-l border-border-seam",
      )}
      data-testid="thread-secondary-panel-placeholder"
    >
      {isOpen ? (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background pt-12">
          {children ?? <SecondaryPanelContentSkeleton />}
        </div>
      ) : null}
    </Panel>
  );
}

type LazyThreadSecondaryPanelProps = ComponentProps<
  ThreadSecondaryPanelModule["ThreadSecondaryPanel"]
> & {
  drawerFallback: ReactNode;
};

const ThreadSecondaryPanelSplit = defineSplit<LazyThreadSecondaryPanelProps>({
  id: "thread-secondary-panel",
  load: () =>
    import("./ThreadSecondaryPanel").then(
      (module) => module.ThreadSecondaryPanel,
    ),
  loading: ({ drawerFallback, ...props }) =>
    props.renderAsDrawer ? (
      drawerFallback
    ) : (
      <ThreadSecondaryPanelInlinePlaceholder
        isOpen={props.isOpen}
        isConversationCollapsed={props.isConversationCollapsed}
        resizablePanelId={props.resizablePanelId}
      />
    ),
  error: (props) =>
    props.renderAsDrawer ? (
      <SplitLoadFailure retry={props.retry} />
    ) : (
      <ThreadSecondaryPanelInlinePlaceholder
        isOpen={props.isOpen}
        isConversationCollapsed={props.isConversationCollapsed}
        resizablePanelId={props.resizablePanelId}
      >
        <SplitLoadFailure retry={props.retry} />
      </ThreadSecondaryPanelInlinePlaceholder>
    ),
  unmounted: (props) =>
    props.renderAsDrawer ? null : (
      <ThreadSecondaryPanelInlinePlaceholder
        isOpen={false}
        isConversationCollapsed={props.isConversationCollapsed}
        resizablePanelId={props.resizablePanelId}
      />
    ),
  mountWhen: (props) => props.isOpen,
  keepMounted: true,
  tier: "preload",
});

export const LazyThreadSecondaryPanel = Object.assign(
  function ThreadSecondaryPanelWithTabWarmup(
    props: LazyThreadSecondaryPanelProps,
  ) {
    useEffect(() => {
      if (props.isOpen) {
        for (const split of panelContentSplits) void split.preload();
      }
    }, [props.isOpen]);
    return <ThreadSecondaryPanelSplit {...props} />;
  },
  ThreadSecondaryPanelSplit,
);

export function preloadThreadSecondaryPanel(): void {
  void LazyThreadSecondaryPanel.preload();
}

export const LazyThreadTerminalPanel = defineSplit({
  id: "thread-terminal-panel",
  load: () =>
    import("@/components/thread/terminal/ThreadTerminalPanel").then(
      (module) => module.ThreadTerminalPanel,
    ),
  loading: () => (
    <div role="status" aria-label="Loading terminal">
      <SecondaryPanelContentSkeleton />
    </div>
  ),
  tier: "intent",
});

export const LazyBrowserTabDeck = defineSplit({
  id: "browser-tab-deck",
  load: () =>
    import("./BrowserTabDeck").then((module) => module.BrowserTabDeck),
  loading: () => null,
  error: (props) =>
    props.activeBrowserTabId === null ? null : (
      <SplitLoadFailure retry={props.retry} />
    ),
  mountWhen: (props) => props.activeBrowserTabId !== null,
  keepMounted: true,
  tier: "intent",
});

export const LazyNewTabPage = defineSplit({
  id: "new-tab-page",
  load: () => import("./NewTabPage").then((module) => module.NewTabPage),
  loading: () => (
    <div role="status" aria-label="Loading new tab">
      <SecondaryPanelContentSkeleton />
    </div>
  ),
  tier: "intent",
});

export const LazyFilePreview = defineSplit({
  id: "file-preview",
  load: () => import("./FilePreview").then((module) => module.FilePreview),
  loading: FilePreviewLoading,
  tier: "intent",
});

export const LazyWorkspaceFilePreviewTabContent = defineSplit({
  id: "workspace-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.WorkspaceFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  tier: "intent",
});

export const LazyHostFilePreviewTabContent = defineSplit({
  id: "host-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.HostFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  tier: "intent",
});

export const LazyHostScopedFilePreviewTabContent = defineSplit({
  id: "host-scoped-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.HostScopedFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  tier: "intent",
});

export const LazyProjectFilePreviewTabContent = defineSplit({
  id: "project-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.ProjectFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  tier: "intent",
});

export const LazyThreadStorageFilePreviewTabContent = defineSplit({
  id: "thread-storage-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.ThreadStorageFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  tier: "intent",
});

const panelContentSplits = [
  LazyBrowserTabDeck,
  LazyThreadTerminalPanel,
  LazyNewTabPage,
  LazyFilePreview,
  LazyWorkspaceFilePreviewTabContent,
  LazyHostFilePreviewTabContent,
  LazyHostScopedFilePreviewTabContent,
  LazyProjectFilePreviewTabContent,
  LazyThreadStorageFilePreviewTabContent,
];
