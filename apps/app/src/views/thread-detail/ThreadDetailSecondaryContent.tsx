import { useMemo, type ComponentProps, type ReactNode } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PluginComposerHostScopeProvider,
  usePluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  SecondaryPanelLayout,
  type SecondaryPanelLayoutDependencies,
} from "@/components/secondary-panel/SecondaryPanelLayout";
import { LazyThreadSecondaryPanel } from "@/components/secondary-panel/lazySecondaryPanelComponents";
import {
  ThreadMetadataCard,
  ThreadMetadataContent,
  hasAnyThreadMetadata,
  type ThreadMetadataContentProps,
} from "@/components/secondary-panel/ThreadMetadataContent";
import { DETAIL_GRID_CLASS } from "@/components/ui/detail-card.js";
import { useThreads } from "@/hooks/queries/thread-queries";
import { ThreadTimelinePane } from "./ThreadTimelinePane";

type ThreadTimelinePaneProps = Omit<
  ComponentProps<typeof ThreadTimelinePane>,
  "footer"
>;
type ThreadSecondaryPanelProps = Omit<
  ComponentProps<typeof LazyThreadSecondaryPanel>,
  | "metadataContent"
  | "renderAsDrawer"
  | "isConversationCollapsed"
  | "onToggleConversationCollapse"
  | "renderBrowserDeck"
  | "drawerFallback"
> & {
  renderBrowserDeck?: (args: {
    activeBrowserTabId?: string | null;
    canHandleBrowserCommands?: boolean;
    canShowNativeBrowserView: boolean;
    onNativeFocus?: () => void;
  }) => ReactNode;
};

interface ThreadDetailSecondaryContentProps {
  footer: ReactNode;
  header: ReactNode;
  isMetadataLoading: boolean;
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  isBoundedPane: boolean;
  onToggleSecondaryPanel: () => void;
  onToggleConversationCollapse: () => void;
  renderHostedPanel: (panel: ReactNode) => ReactNode;
  metadata: ThreadMetadataContentProps;
  secondaryPanel: ThreadSecondaryPanelProps;
  timeline: ThreadTimelinePaneProps;
  dependencies?: ThreadDetailSecondaryContentDependencies;
}

interface ThreadDetailSecondaryContentDependencies {
  LazyThreadSecondaryPanel: typeof LazyThreadSecondaryPanel;
  SecondaryPanelLayout: typeof SecondaryPanelLayout;
  ThreadMetadataContent: typeof ThreadMetadataContent;
  ThreadTimelinePane: typeof ThreadTimelinePane;
  hasAnyThreadMetadata: typeof hasAnyThreadMetadata;
  useThreads: typeof useThreads;
  secondaryPanelLayoutDependencies?: SecondaryPanelLayoutDependencies;
}

const defaultThreadDetailSecondaryContentDependencies: ThreadDetailSecondaryContentDependencies =
  {
    LazyThreadSecondaryPanel,
    SecondaryPanelLayout,
    ThreadMetadataContent,
    ThreadTimelinePane,
    hasAnyThreadMetadata,
    useThreads,
  };

export function ThreadDetailSecondaryContent(
  props: ThreadDetailSecondaryContentProps,
) {
  return (
    <PluginComposerHostScopeProvider>
      <ThreadDetailSecondaryContentBody
        {...props}
        dependencies={
          props.dependencies ?? defaultThreadDetailSecondaryContentDependencies
        }
      />
    </PluginComposerHostScopeProvider>
  );
}

function ThreadDetailSecondaryContentBody({
  footer,
  header,
  isMetadataLoading,
  isSecondaryPanelOpen,
  isConversationCollapsed,
  isBoundedPane,
  onToggleSecondaryPanel,
  onToggleConversationCollapse,
  renderHostedPanel,
  metadata,
  secondaryPanel,
  timeline,
  dependencies = defaultThreadDetailSecondaryContentDependencies,
}: ThreadDetailSecondaryContentProps) {
  const composerHost = usePluginComposerHost();
  const { renderBrowserDeck, ...threadSecondaryPanelProps } = secondaryPanel;

  const forksQuery = dependencies.useThreads(
    {
      projectId: metadata.thread.projectId,
      sourceThreadId: metadata.thread.id,
      originKind: "fork",
      archived: false,
    },
    { enabled: isSecondaryPanelOpen },
  );
  const hasForks = (forksQuery.data?.length ?? 0) > 0;
  const metadataContent = useMemo(
    () =>
      dependencies.hasAnyThreadMetadata(metadata, hasForks) ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <dependencies.ThreadMetadataContent {...metadata} />
        </div>
      ) : isMetadataLoading ? (
        <ThreadMetadataLoadingSkeleton />
      ) : (
        <div className="px-4 pt-1 text-sm text-muted-foreground">
          No thread details available.
        </div>
      ),
    [dependencies, hasForks, isMetadataLoading, metadata],
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip",
        !isBoundedPane && "-mx-4 -mb-4 -mt-4 md:-mx-5 md:-mb-5 md:-mt-5",
      )}
    >
      <dependencies.SecondaryPanelLayout
        open={isSecondaryPanelOpen}
        onToggle={onToggleSecondaryPanel}
        onClose={threadSecondaryPanelProps.onClose}
        panelGroupKey="thread-detail"
        resetKey={timeline.threadId}
        contentKey={timeline.threadId}
        drawerLabel="Thread details"
        drawerFallback={<ThreadMetadataLoadingSkeleton />}
        mainPanelId="thread-detail-timeline-panel"
        mainHeader={header}
        main={<dependencies.ThreadTimelinePane {...timeline} footer={footer} />}
        collapse={{
          active: isConversationCollapsed,
          onToggle: onToggleConversationCollapse,
        }}
        composerHost={composerHost}
        renderHostedPanel={renderHostedPanel}
        renderPanel={({
          presentation,
          canShowNativeBrowserView,
          inlinePanelToggle,
          isMainCollapsed,
          onToggleMainCollapse,
          resizablePanelId,
        }) => (
          <dependencies.LazyThreadSecondaryPanel
            {...threadSecondaryPanelProps}
            drawerFallback={<ThreadMetadataLoadingSkeleton />}
            renderBrowserDeck={(activeBrowserTabId, pane) =>
              renderBrowserDeck?.({
                activeBrowserTabId,
                canHandleBrowserCommands:
                  canShowNativeBrowserView && pane.isFocused,
                canShowNativeBrowserView,
                onNativeFocus: pane.onFocusPane,
              })
            }
            renderAsDrawer={presentation === "drawer"}
            isConversationCollapsed={
              presentation === "inline" && isMainCollapsed
            }
            onToggleConversationCollapse={onToggleMainCollapse}
            inlinePanelToggle={
              presentation === "inline" ? "reserved" : inlinePanelToggle
            }
            resizablePanelId={resizablePanelId}
            metadataContent={metadataContent}
          />
        )}
        dependencies={dependencies.secondaryPanelLayoutDependencies}
      />
    </div>
  );
}

const METADATA_SKELETON_ROW_VALUE_WIDTHS = ["w-40", "w-28", "w-36", "w-24"];

function ThreadMetadataLoadingSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ThreadMetadataCard>
        {METADATA_SKELETON_ROW_VALUE_WIDTHS.map((valueWidth, index) => (
          <div
            key={index}
            className={cn(DETAIL_GRID_CLASS, "items-center py-0.5")}
          >
            <Skeleton className="h-3 w-14 rounded-sm" />
            <Skeleton className={`h-3 ${valueWidth} max-w-full rounded-sm`} />
          </div>
        ))}
      </ThreadMetadataCard>
    </div>
  );
}
