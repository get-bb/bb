import { defineSplit, SplitLoadFailure } from "@/lib/define-split";
import {
  useEffect,
  useState,
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
type ThreadStorageFileTreeModule = typeof import("./ThreadStorageFileTree");

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
  preload: "startup",
});

function useRetainedRealization(active: boolean): boolean {
  const [realized, setRealized] = useState(active);
  if (active && !realized) setRealized(true);
  return active || realized;
}

export const LazyThreadSecondaryPanel = Object.assign(
  function ThreadSecondaryPanelGate(props: LazyThreadSecondaryPanelProps) {
    const realized = useRetainedRealization(props.isOpen);
    useEffect(() => {
      if (props.isOpen) {
        for (const split of panelContentSplits) void split.preload();
      }
    }, [props.isOpen]);
    if (!realized) {
      return props.renderAsDrawer ? null : (
        <ThreadSecondaryPanelInlinePlaceholder
          isOpen={false}
          isConversationCollapsed={props.isConversationCollapsed}
          resizablePanelId={props.resizablePanelId}
        />
      );
    }
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
  preload: "render",
});

const BrowserTabDeckSplit = defineSplit({
  id: "browser-tab-deck",
  load: () =>
    import("./BrowserTabDeck").then((module) => module.BrowserTabDeck),
  loading: () => null,
  error: (props) =>
    props.activeBrowserTabId === null ? null : (
      <SplitLoadFailure retry={props.retry} />
    ),
  preload: "render",
});

export const LazyBrowserTabDeck = Object.assign(function BrowserTabDeckGate(
  props: ComponentProps<typeof BrowserTabDeckSplit>,
) {
  const realized = useRetainedRealization(props.activeBrowserTabId !== null);
  return realized ? <BrowserTabDeckSplit {...props} /> : null;
}, BrowserTabDeckSplit);

export const LazyNewTabPage = defineSplit({
  id: "new-tab-page",
  load: () => import("./NewTabPage").then((module) => module.NewTabPage),
  loading: () => (
    <div role="status" aria-label="Loading new tab">
      <SecondaryPanelContentSkeleton />
    </div>
  ),
  preload: "render",
});

export const LazyFilePreview = defineSplit({
  id: "file-preview",
  load: () => import("./FilePreview").then((module) => module.FilePreview),
  loading: FilePreviewLoading,
  preload: "render",
});

export const LazyThreadStorageFileTree = defineSplit<
  ComponentProps<ThreadStorageFileTreeModule["ThreadStorageFileTree"]> & {
    fallback: ReactNode;
  }
>({
  id: "thread-storage-file-tree",
  load: () =>
    import("./ThreadStorageFileTree").then(
      (module) => module.ThreadStorageFileTree,
    ),
  loading: ({ fallback }) => fallback,
  preload: "render",
});

export const LazyWorkspaceFilePreviewTabContent = defineSplit({
  id: "workspace-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.WorkspaceFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  preload: "render",
});

export const LazyHostFilePreviewTabContent = defineSplit({
  id: "host-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.HostFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  preload: "render",
});

export const LazyHostScopedFilePreviewTabContent = defineSplit({
  id: "host-scoped-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.HostScopedFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  preload: "render",
});

export const LazyProjectFilePreviewTabContent = defineSplit({
  id: "project-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.ProjectFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  preload: "render",
});

export const LazyThreadStorageFilePreviewTabContent = defineSplit({
  id: "thread-storage-file-preview-tab",
  load: () =>
    import("./ThreadSecondaryPanelTabContent").then(
      (module) => module.ThreadStorageFilePreviewTabContent,
    ),
  loading: FilePreviewLoading,
  preload: "render",
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
