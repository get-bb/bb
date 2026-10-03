import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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

import {
  forgetClosedPanelTab,
  getPanelTabOrder,
  rememberClosedPanelTab,
  setPanelTabOrder,
  subscribePanelTabOrder,
} from "@/components/secondary-panel/recentlyClosedPanelTabs";

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
  restore: (entry: {
    index: number;
    destination: PluginDetailDestination;
  }) => void;
  tabOrder: readonly string[];
  setTabOrder: (order: string[]) => void;
}

export const PluginDetailPanelContext =
  createContext<PluginDetailPanelState | null>(null);

export function usePluginDetailPanelState(
  resetKey: Key,
  isFocused: boolean,
  historyContextKey: string | null = null,
) {
  const [destinations, setDestinations] = useState<PluginDetailDestination[]>(
    [],
  );
  const destinationsRef = useRef(destinations);
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const localOrderId = useId();
  const orderKey = historyContextKey ?? `${localOrderId}:${resetKey}`;
  const subscribeOrder = useCallback(
    (listener: () => void) => subscribePanelTabOrder(orderKey, listener),
    [orderKey],
  );
  const getOrder = useCallback(() => getPanelTabOrder(orderKey), [orderKey]);
  const tabOrder = useSyncExternalStore(subscribeOrder, getOrder, getOrder);
  const setTabOrder = useCallback(
    (order: string[]) => setPanelTabOrder(orderKey, order),
    [orderKey],
  );
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
    destinationsRef.current = [];
    // oxlint-disable-next-line react/set-state-in-effect
    setActivePluginId(null);
  }, [resetKey]);
  const dismiss = useCallback(() => setActivePluginId(null), []);
  const open = useCallback<PluginDetailOpener>(
    (destination) => {
      if (historyContextKey !== null)
        forgetClosedPanelTab(
          historyContextKey,
          `marketplace-plugin:${destination.pluginId}`,
        );
      const current = destinationsRef.current;
      const next = current.some(
        (entry) => entry.pluginId === destination.pluginId,
      )
        ? current
        : [...current, destination];
      destinationsRef.current = next;
      setDestinations(next);
      setActivePluginId(destination.pluginId);
      return true;
    },
    [historyContextKey],
  );
  const restore = useCallback(
    ({
      destination,
    }: {
      index: number;
      destination: PluginDetailDestination;
    }) => {
      open(destination);
    },
    [open],
  );
  const close = useCallback(
    (pluginId: string) => {
      const index = orderedDestinations.findIndex(
        (entry) => entry.pluginId === pluginId,
      );
      const destination = destinationsRef.current.find(
        (entry) => entry.pluginId === pluginId,
      );
      if (destination === undefined) return;
      const remaining = arrangeByStoredOrder({
        items: destinationsRef.current.filter(
          (entry) => entry.pluginId !== pluginId,
        ),
        getId: (entry) => `marketplace-plugin:${entry.pluginId}`,
        storedOrder: tabOrder,
      }).ordered;
      destinationsRef.current = remaining;
      if (historyContextKey !== null) {
        rememberClosedPanelTab(historyContextKey, {
          kind: "plugin-detail",
          index,
          destination,
        });
      }
      setDestinations(remaining);
      if (activePluginId === pluginId) {
        setActivePluginId(
          remaining[Math.min(index, remaining.length - 1)]?.pluginId ?? null,
        );
      }
    },
    [activePluginId, historyContextKey, orderedDestinations, tabOrder],
  );
  usePublishPluginDetailOpener(open, isFocused);
  return useMemo(
    () => ({
      activePluginId,
      destinations: orderedDestinations,
      dismiss,
      close,
      open,
      restore,
      tabOrder,
      setTabOrder,
    }),
    [
      activePluginId,
      orderedDestinations,
      dismiss,
      close,
      open,
      restore,
      tabOrder,
      setTabOrder,
    ],
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
  const visibleIds = [
    ...props.tabs.map((tab) => tab.tab.id),
    ...(details?.destinations.map(
      (destination) => `marketplace-plugin:${destination.pluginId}`,
    ) ?? []),
  ];
  const displayedOrder = details?.destinations.length
    ? arrangeByStoredOrder({
        items: visibleIds,
        getId: (id) => id,
        storedOrder: details.tabOrder,
      }).ordered
    : visibleIds;
  const setTabOrder = details?.setTabOrder;
  useLayoutEffect(() => {
    setTabOrder?.(displayedOrder);
  }, [displayedOrder, setTabOrder]);
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
