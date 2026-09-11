import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Key,
} from "react";
import { PluginIcon } from "./PluginIcon";
import { arrayMove } from "@bb/client-core";
import { arrangeByStoredOrder } from "@/lib/stored-order";
import type { SecondaryPanelRenderableTab } from "@/components/secondary-panel/ThreadSecondaryPanel";
import type { ThreadSecondaryPanelProps } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { SecondaryPanelContentSkeleton } from "@/components/secondary-panel/lazySecondaryPanelComponents";
import {
  usePublishPluginDetailOpener,
  type PluginDetailDestination,
  type PluginDetailOpener,
} from "./plugin-detail-opener";

const LazyPluginDetailPaneView = lazy(() =>
  import("@/views/ToolsView").then(({ PluginDetailPaneView }) => ({
    default: PluginDetailPaneView,
  })),
);

export function PluginDetailTabContent({ pluginId }: { pluginId: string }) {
  return (
    <Suspense fallback={<SecondaryPanelContentSkeleton />}>
      <LazyPluginDetailPaneView pluginId={pluginId} />
    </Suspense>
  );
}

interface PluginDetailPanelState {
  activePluginId: string | null;
  destinations: readonly PluginDetailDestination[];
  dismiss: () => void;
  close: (pluginId: string) => void;
  open: PluginDetailOpener;
  tabOrder: readonly string[];
  setTabOrder: (order: string[]) => void;
}

export const PluginDetailPanelContext =
  createContext<PluginDetailPanelState | null>(null);

export function usePluginDetailPanelState(resetKey: Key, isFocused: boolean) {
  const [destinations, setDestinations] = useState<PluginDetailDestination[]>(
    [],
  );
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const orderedDestinations = useMemo(
    () =>
      arrangeByStoredOrder({
        items: destinations,
        getId: (destination) => `marketplace-plugin:${destination.pluginId}`,
        storedOrder: tabOrder,
      }).ordered,
    [destinations, tabOrder],
  );
  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setDestinations([]);
    // oxlint-disable-next-line react/set-state-in-effect
    setActivePluginId(null);
    // oxlint-disable-next-line react/set-state-in-effect
    setTabOrder([]);
  }, [resetKey]);
  const dismiss = useCallback(() => setActivePluginId(null), []);
  const open = useCallback<PluginDetailOpener>((destination) => {
    setDestinations((current) =>
      current.some((entry) => entry.pluginId === destination.pluginId)
        ? current
        : [...current, destination],
    );
    setActivePluginId(destination.pluginId);
    return true;
  }, []);
  const close = useCallback(
    (pluginId: string) => {
      const index = orderedDestinations.findIndex(
        (entry) => entry.pluginId === pluginId,
      );
      const remaining = orderedDestinations.filter(
        (entry) => entry.pluginId !== pluginId,
      );
      setDestinations(remaining);
      setTabOrder((current) =>
        current.filter((id) => id !== `marketplace-plugin:${pluginId}`),
      );
      if (activePluginId === pluginId) {
        setActivePluginId(
          remaining[Math.min(index, remaining.length - 1)]?.pluginId ?? null,
        );
      }
    },
    [activePluginId, orderedDestinations],
  );
  usePublishPluginDetailOpener(open, isFocused);
  return useMemo(
    () => ({
      activePluginId,
      destinations: orderedDestinations,
      dismiss,
      close,
      open,
      tabOrder,
      setTabOrder,
    }),
    [activePluginId, orderedDestinations, dismiss, close, open, tabOrder],
  );
}

export function usePluginDetailPanelProps(
  props: ThreadSecondaryPanelProps,
): ThreadSecondaryPanelProps {
  const details = useContext(PluginDetailPanelContext);
  const activeTabId = props.activeTab?.id;
  const previousActiveTabId = useRef(activeTabId);
  const dismiss = details?.dismiss;
  useLayoutEffect(() => {
    if (previousActiveTabId.current !== activeTabId) dismiss?.();
    previousActiveTabId.current = activeTabId;
  }, [activeTabId, dismiss]);
  if (details === null || details.destinations.length === 0) return props;
  const active = details.activePluginId;
  const selectExisting = (select: () => void) => () => {
    details.dismiss();
    select();
  };
  const { ordered: tabs } = arrangeByStoredOrder<SecondaryPanelRenderableTab>({
    items: [
      ...props.tabs.map((tab) => ({
        ...tab,
        onSelect: selectExisting(tab.onSelect),
      })),
      ...details.destinations.map((destination) => ({
        contentFillsRegion: true,
        label: destination.title,
        leadingVisual: (
          <PluginIcon
            pluginId={destination.pluginId}
            icon={null}
            className="size-3.5"
          />
        ),
        onClose: () => details.close(destination.pluginId),
        onSelect: () => details.open(destination),
        renderContent: () => (
          <PluginDetailTabContent pluginId={destination.pluginId} />
        ),
        statusLabel: null,
        tab: {
          id: `marketplace-plugin:${destination.pluginId}`,
          kind: "marketplace-plugin-detail" as const,
        },
      })),
    ],
    getId: (tab) => tab.tab.id,
    storedOrder: details.tabOrder,
  });
  return {
    ...props,
    activeTab:
      active === null
        ? props.activeTab
        : {
            id: `marketplace-plugin:${active}`,
            kind: "marketplace-plugin-detail",
          },
    isOpen: active !== null || props.isOpen,
    splitPanelStateId: active === null ? props.splitPanelStateId : undefined,
    onClose: selectExisting(props.onClose),
    onCollapse: selectExisting(props.onCollapse),
    onOpenNewTab: selectExisting(props.onOpenNewTab),
    fixedTabs: props.fixedTabs.map((tab) => ({
      ...tab,
      onSelect: selectExisting(tab.onSelect),
    })),
    tabs,
    onTabReorder: ({ activeTabId, overTabId }) => {
      const ids = tabs.map((tab) => tab.tab.id);
      const from = ids.indexOf(activeTabId);
      const to = ids.indexOf(overTabId);
      if (from === -1 || to === -1 || from === to) return;
      const nextOrder = arrayMove(ids, from, to);
      details.setTabOrder(nextOrder);
      const existingIds = new Set(props.tabs.map((tab) => tab.tab.id));
      if (!existingIds.has(activeTabId)) return;
      const nextIndex = nextOrder
        .filter((id) => existingIds.has(id))
        .indexOf(activeTabId);
      const existingTarget = props.tabs[nextIndex];
      if (existingTarget !== undefined) {
        props.onTabReorder({ activeTabId, overTabId: existingTarget.tab.id });
      }
    },
  };
}
