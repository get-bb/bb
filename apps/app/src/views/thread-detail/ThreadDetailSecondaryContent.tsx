import { useMemo, type ComponentProps, type ReactNode } from "react";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PluginComposerHostScopeProvider,
  usePluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import { SecondaryPanelLayout } from "@/components/secondary-panel/SecondaryPanelLayout";
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
  | "browserDeck"
  | "drawerFallback"
> & {
  renderBrowserDeck?: (args: {
    canShowNativeBrowserView: boolean;
  }) => ReactNode;
};

interface ThreadDetailSecondaryContentProps {
  footer: ReactNode;
  header: ReactNode;
  isMetadataLoading: boolean;
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  /**
   * True when rendering inside a bounded split card. Bounded panes skip the
   * page-bleed negative margins below — the card supplies the boundary, so
   * bleeding out of it only gets clipped by the card's overflow-hidden.
   */
  isBoundedPane: boolean;
  onToggleSecondaryPanel: () => void;
  onToggleConversationCollapse: () => void;
  renderHostedPanel: (panel: ReactNode) => ReactNode;
  metadata: ThreadMetadataContentProps;
  secondaryPanel: ThreadSecondaryPanelProps;
  timeline: ThreadTimelinePaneProps;
}

export function ThreadDetailSecondaryContent(
  props: ThreadDetailSecondaryContentProps,
) {
  return (
    <PluginComposerHostScopeProvider>
      <ThreadDetailSecondaryContentBody {...props} />
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
}: ThreadDetailSecondaryContentProps) {
  const composerHost = usePluginComposerHost();
  const { renderBrowserDeck, ...threadSecondaryPanelProps } = secondaryPanel;

  // Mirror ForksRow's query (deduped by react-query) so the visibility gate
  // accounts for the lazily fetched Forks row. Only the open panel renders the
  // Info tab, so a closed panel does not need the request.
  const forksQuery = useThreads(
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
      hasAnyThreadMetadata(metadata, hasForks) ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ThreadMetadataContent {...metadata} />
        </div>
      ) : isMetadataLoading ? (
        <ThreadMetadataLoadingSkeleton />
      ) : (
        <div className="px-4 pt-1 text-sm text-muted-foreground">
          No thread details available.
        </div>
      ),
    [hasForks, isMetadataLoading, metadata],
  );

  return (
    <div
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-clip",
        !isBoundedPane && "-mx-4 -mb-4 -mt-4 md:-mx-5 md:-mb-5 md:-mt-5",
      )}
    >
      <SecondaryPanelLayout
        open={isSecondaryPanelOpen}
        onToggle={onToggleSecondaryPanel}
        onClose={threadSecondaryPanelProps.onClose}
        resetKey={timeline.threadId}
        contentKey={timeline.threadId}
        drawerLabel="Thread details"
        drawerFallback={<ThreadMetadataLoadingSkeleton />}
        mainPanelId="thread-detail-timeline-panel"
        mainHeader={header}
        main={<ThreadTimelinePane {...timeline} footer={footer} />}
        collapse={{
          active: isConversationCollapsed,
          onToggle: onToggleConversationCollapse,
        }}
        composerHost={composerHost}
        renderHostedPanel={renderHostedPanel}
        renderPanel={({
          presentation,
          canShowNativeBrowserView,
          isMainCollapsed,
          onToggleMainCollapse,
          resizablePanelId,
        }) => (
          <LazyThreadSecondaryPanel
            {...threadSecondaryPanelProps}
            drawerFallback={<ThreadMetadataLoadingSkeleton />}
            browserDeck={renderBrowserDeck?.({ canShowNativeBrowserView })}
            renderAsDrawer={presentation === "drawer"}
            isConversationCollapsed={
              presentation === "inline" && isMainCollapsed
            }
            onToggleConversationCollapse={onToggleMainCollapse}
            {...(presentation === "inline"
              ? { inlinePanelToggle: "button" as const }
              : {})}
            resizablePanelId={resizablePanelId}
            metadataContent={metadataContent}
          />
        )}
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
