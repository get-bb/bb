import { useMemo, type ComponentProps, type ReactNode } from "react";
import type { ExperimentalThreadEnvironment } from "@get-bb/plugin-sdk";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  PluginComposerHostScopeProvider,
  usePluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import { SecondaryPanelLayout } from "@/components/secondary-panel/SecondaryPanelLayout";
import { getThreadSecondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import {
  LazyThreadSecondaryPanel,
  ThreadSecondaryPanelDrawerPlaceholder,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";
import { useOptionalPaneContext } from "./PaneContext";

type ThreadSecondaryPanelProps = Omit<
  ComponentProps<typeof LazyThreadSecondaryPanel>,
  | "threadInfo"
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
  header: ReactNode;
  threadId: string;
  environment: ExperimentalThreadEnvironment | null;
  isSecondaryPanelOpen: boolean;
  isConversationCollapsed: boolean;
  isBoundedPane: boolean;
  main: ReactNode;
  onToggleSecondaryPanel: () => void;
  onToggleConversationCollapse: () => void;
  renderHostedPanel: (panel: ReactNode) => ReactNode;
  secondaryPanel: ThreadSecondaryPanelProps;
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
  header,
  threadId,
  environment,
  isSecondaryPanelOpen,
  isConversationCollapsed,
  isBoundedPane,
  main,
  onToggleSecondaryPanel,
  onToggleConversationCollapse,
  renderHostedPanel,
  secondaryPanel,
}: ThreadDetailSecondaryContentProps) {
  const paneContext = useOptionalPaneContext();
  const composerHost = usePluginComposerHost();
  const { renderBrowserDeck, ...threadSecondaryPanelProps } = secondaryPanel;
  const threadInfo = useMemo(
    () => ({ threadId, environment }),
    [threadId, environment],
  );
  const drawerFallback = (
    <ThreadSecondaryPanelDrawerPlaceholder
      activeTab={threadSecondaryPanelProps.activeTab}
      threadInfo={threadInfo}
    />
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
        onSwipeOpen={onToggleSecondaryPanel}
        onClose={threadSecondaryPanelProps.onClose}
        panelGroupKey="thread-detail"
        resetKey={threadId}
        contentKey={threadId}
        drawerLabel="Thread details"
        drawerFallback={drawerFallback}
        mainPanelId="thread-detail-timeline-panel"
        mainHeader={header}
        main={main}
        collapse={{
          active: isConversationCollapsed,
          onToggle: onToggleConversationCollapse,
        }}
        composerHost={composerHost}
        widthPercentAtom={getThreadSecondaryPanelWidthPercentAtom(threadId)}
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
            drawerFallback={drawerFallback}
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
            resizablePanelId={resizablePanelId}
            isAtWindowTop={paneContext?.isTopRow !== false}
            threadInfo={threadInfo}
          />
        )}
      />
    </div>
  );
}
