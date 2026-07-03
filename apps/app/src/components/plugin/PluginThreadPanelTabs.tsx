import { Button } from "@/components/ui/button.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { useRouteState } from "@/hooks/useRouteState";
import {
  usePluginSlots,
  type PluginThreadPanelTabSlot,
} from "@/lib/plugin-slots";
import {
  buildPluginThreadPanelKey,
  type ThreadSecondaryPanel,
} from "@/lib/thread-secondary-panel";
import { PluginSlotMount } from "./PluginSlotMount";

/**
 * Plugin `threadPanelTab` slot mounts (plugin design §5.2): toggle buttons
 * in the secondary panel chrome next to Info/Diff, plus the active tab's
 * content region. Both read the thread from the route, so they render
 * nothing outside a thread view (e.g. the root compose panel).
 */

function isTabVisible(
  tab: PluginThreadPanelTabSlot,
  threadId: string,
): boolean {
  if (tab.visible === undefined) return true;
  try {
    // V1 predicate contract is synchronous (design allows async later).
    return tab.visible({ threadId }) === true;
  } catch (error) {
    console.warn(
      `[plugin:${tab.pluginId}] threadPanelTab "${tab.id}" visible() threw — hiding the tab: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

export interface PluginThreadPanelTabButtonsProps {
  activePanel: ThreadSecondaryPanel;
  hasActiveFileTab: boolean;
  onPanelChange: (panel: ThreadSecondaryPanel) => void;
  className?: string;
}

export function PluginThreadPanelTabButtons(
  props: PluginThreadPanelTabButtonsProps,
) {
  const { threadPanelTabs } = usePluginSlots();
  // Router hooks live in the inner component so hosts without a Router
  // (isolated panel tests/stories) can render the empty state.
  if (threadPanelTabs.length === 0) return null;
  return (
    <PluginThreadPanelTabButtonList {...props} tabs={threadPanelTabs} />
  );
}

function PluginThreadPanelTabButtonList({
  activePanel,
  hasActiveFileTab,
  onPanelChange,
  className,
  tabs,
}: PluginThreadPanelTabButtonsProps & {
  tabs: readonly PluginThreadPanelTabSlot[];
}) {
  const { threadId } = useRouteState();
  if (threadId === undefined) return null;
  const visibleTabs = tabs.filter((tab) => isTabVisible(tab, threadId));
  if (visibleTabs.length === 0) return null;
  return (
    <>
      {visibleTabs.map((tab) => {
        const panelKey = buildPluginThreadPanelKey(tab.pluginId, tab.id);
        return (
          <Button
            key={panelKey}
            type="button"
            variant="ghost"
            size="sm"
            className={className}
            onClick={() => onPanelChange(panelKey)}
            aria-label={`Show ${tab.title} panel`}
            aria-pressed={activePanel === panelKey && !hasActiveFileTab}
          >
            {tab.title}
          </Button>
        );
      })}
    </>
  );
}

export function PluginThreadPanelTabContent({
  panelKey,
}: {
  panelKey: string;
}) {
  const { threadPanelTabs } = usePluginSlots();
  const { threadId } = useRouteState();
  const tab =
    threadPanelTabs.find(
      (candidate) =>
        buildPluginThreadPanelKey(candidate.pluginId, candidate.id) ===
        panelKey,
    ) ?? null;
  if (tab === null || threadId === undefined) {
    // A persisted selection can outlive its plugin (disabled/removed) or
    // arrive before the plugin frontends finish loading.
    return (
      <div className="p-4">
        <EmptyStatePanel className="rounded-lg p-6 text-sm">
          This plugin tab is not available. The plugin may still be loading,
          or it has been disabled or removed.
        </EmptyStatePanel>
      </div>
    );
  }
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto p-4"
      data-testid="plugin-thread-panel-tab-content"
    >
      <PluginSlotMount
        // Generation in the key: a P3.4 reload remounts the slot (fresh
        // error-boundary state).
        key={`${tab.pluginId}/${tab.id}/${tab.generation}`}
        pluginId={tab.pluginId}
        slotKind="threadPanelTab"
        slotId={tab.id}
      >
        <tab.component threadId={threadId} />
      </PluginSlotMount>
    </div>
  );
}
