import { defineSplit, SplitLoadFailure } from "@/lib/define-split";
import {
  lazy,
  Suspense,
  type ComponentProps,
  type ComponentType,
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

const ThreadTerminalPanelChunk = lazy(() =>
  import("@/components/thread/terminal/ThreadTerminalPanel").then(
    ({ ThreadTerminalPanel }) => ({ default: ThreadTerminalPanel }),
  ),
);
const BrowserTabDeckChunk = lazy(() =>
  import("./BrowserTabDeck").then(({ BrowserTabDeck }) => ({
    default: BrowserTabDeck,
  })),
);
const NewTabPageChunk = lazy(() =>
  import("./NewTabPage").then(({ NewTabPage }) => ({ default: NewTabPage })),
);
const ThreadStorageFileTreeChunk = lazy(() =>
  import("./ThreadStorageFileTree").then(({ ThreadStorageFileTree }) => ({
    default: ThreadStorageFileTree,
  })),
);
const WorkspaceFilePreviewTabContentChunk = lazy(() =>
  import("./ThreadSecondaryPanelTabContent").then(
    ({ WorkspaceFilePreviewTabContent }) => ({
      default: WorkspaceFilePreviewTabContent,
    }),
  ),
);
const HostFilePreviewTabContentChunk = lazy(() =>
  import("./ThreadSecondaryPanelTabContent").then(
    ({ HostFilePreviewTabContent }) => ({
      default: HostFilePreviewTabContent,
    }),
  ),
);
const HostScopedFilePreviewTabContentChunk = lazy(() =>
  import("./ThreadSecondaryPanelTabContent").then(
    ({ HostScopedFilePreviewTabContent }) => ({
      default: HostScopedFilePreviewTabContent,
    }),
  ),
);
const ProjectFilePreviewTabContentChunk = lazy(() =>
  import("./ThreadSecondaryPanelTabContent").then(
    ({ ProjectFilePreviewTabContent }) => ({
      default: ProjectFilePreviewTabContent,
    }),
  ),
);
const ThreadStorageFilePreviewTabContentChunk = lazy(() =>
  import("./ThreadSecondaryPanelTabContent").then(
    ({ ThreadStorageFilePreviewTabContent }) => ({
      default: ThreadStorageFilePreviewTabContent,
    }),
  ),
);

function withSuspense<P extends object>(
  Chunk: ComponentType<P>,
  fallback: ReactNode,
) {
  return function LazySecondaryPanelComponent(props: P) {
    return (
      <Suspense fallback={fallback}>
        <Chunk {...props} />
      </Suspense>
    );
  };
}

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

export const LazyThreadSecondaryPanel =
  defineSplit<LazyThreadSecondaryPanelProps>({
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
    preload: "idle",
  });

export function preloadThreadSecondaryPanel(): void {
  void LazyThreadSecondaryPanel.preload();
}

export const LazyThreadTerminalPanel = withSuspense(
  ThreadTerminalPanelChunk,
  <SecondaryPanelContentSkeleton />,
);

export const LazyBrowserTabDeck = withSuspense(BrowserTabDeckChunk, null);

export const LazyNewTabPage = withSuspense(
  NewTabPageChunk,
  <SecondaryPanelContentSkeleton />,
);

export const LazyFilePreview = defineSplit({
  id: "file-preview",
  load: () => import("./FilePreview").then((module) => module.FilePreview),
  loading: () => (
    <div role="status" aria-label="Loading file preview">
      <SecondaryPanelContentSkeleton />
    </div>
  ),
  preload: "render",
});

export function LazyThreadStorageFileTree({
  fallback,
  ...props
}: ComponentProps<ThreadStorageFileTreeModule["ThreadStorageFileTree"]> & {
  fallback: ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <ThreadStorageFileTreeChunk {...props} />
    </Suspense>
  );
}

export const LazyWorkspaceFilePreviewTabContent = withSuspense(
  WorkspaceFilePreviewTabContentChunk,
  <SecondaryPanelContentSkeleton />,
);

export const LazyHostFilePreviewTabContent = withSuspense(
  HostFilePreviewTabContentChunk,
  <SecondaryPanelContentSkeleton />,
);

export const LazyHostScopedFilePreviewTabContent = withSuspense(
  HostScopedFilePreviewTabContentChunk,
  <SecondaryPanelContentSkeleton />,
);

export const LazyProjectFilePreviewTabContent = withSuspense(
  ProjectFilePreviewTabContentChunk,
  <SecondaryPanelContentSkeleton />,
);

export const LazyThreadStorageFilePreviewTabContent = withSuspense(
  ThreadStorageFilePreviewTabContentChunk,
  <SecondaryPanelContentSkeleton />,
);
