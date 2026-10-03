import type { FixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import type { PluginDetailDestination } from "@/components/plugin/plugin-detail-opener";
import { haveSameOrder } from "@/lib/stored-order";

export interface ClosedPanelContentTab {
  kind: "content";
  index: number;
  tab: Exclude<
    FixedPanelTab,
    { kind: "thread-info" | "git-diff" | "plugin-page-fixed" | "terminal" }
  >;
}

interface ClosedPluginDetailTab {
  kind: "plugin-detail";
  index: number;
  destination: PluginDetailDestination;
}

export interface PluginDetailHistoryTarget {
  destinations: readonly PluginDetailDestination[];
  dismiss: () => void;
  restore: (entry: {
    index: number;
    destination: PluginDetailDestination;
  }) => void;
}

type ClosedPanelTab = ClosedPanelContentTab | ClosedPluginDetailTab;
const recentlyClosedPanelTabs = new Map<
  string,
  (ClosedPanelTab & { orderIndex?: number })[]
>();
const panelTabOrders = new Map<string, readonly string[]>();
const orderListeners = new Map<string, Set<() => void>>();
const emptyOrder: readonly string[] = [];

export function getPanelTabOrder(contextKey: string): readonly string[] {
  return panelTabOrders.get(contextKey) ?? emptyOrder;
}

export function setPanelTabOrder(
  contextKey: string,
  order: readonly string[],
): void {
  if (haveSameOrder(getPanelTabOrder(contextKey), order)) return;
  panelTabOrders.set(contextKey, order);
  orderListeners.get(contextKey)?.forEach((listener) => listener());
}

export function subscribePanelTabOrder(
  contextKey: string,
  listener: () => void,
): () => void {
  const listeners = orderListeners.get(contextKey) ?? new Set();
  listeners.add(listener);
  orderListeners.set(contextKey, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    orderListeners.delete(contextKey);
    if (!recentlyClosedPanelTabs.has(contextKey))
      panelTabOrders.delete(contextKey);
  };
}

export function getPanelTabHistoryKey({
  environmentId,
  fileOwnerThreadId,
  panelStateId,
  projectHostId = null,
  projectId = null,
}: {
  environmentId: string | null | undefined;
  fileOwnerThreadId: string | null;
  panelStateId: string | null;
  projectHostId?: string | null;
  projectId?: string | null;
}): string | null {
  return panelStateId === null
    ? null
    : JSON.stringify({
        environmentId,
        fileOwnerThreadId,
        panelStateId,
        projectHostId,
        projectId,
      });
}

function closedTabId(entry: ClosedPanelTab): string {
  return entry.kind === "content"
    ? entry.tab.id
    : `marketplace-plugin:${entry.destination.pluginId}`;
}

export function rememberClosedPanelTab(
  contextKey: string,
  entry: ClosedPanelTab,
): void {
  const stack = recentlyClosedPanelTabs.get(contextKey) ?? [];
  const order = getPanelTabOrder(contextKey);
  const orderIndex = order.indexOf(closedTabId(entry));
  stack.push(orderIndex === -1 ? entry : { ...entry, orderIndex });
  if (stack.length > 25) stack.splice(0, stack.length - 25);
  recentlyClosedPanelTabs.set(contextKey, stack);
  if (orderIndex !== -1)
    setPanelTabOrder(
      contextKey,
      order.filter((id) => id !== closedTabId(entry)),
    );
}

export function forgetClosedPanelTab(contextKey: string, tabId: string): void {
  const stack = recentlyClosedPanelTabs.get(contextKey);
  if (stack === undefined) return;
  const next = stack.filter((entry) => closedTabId(entry) !== tabId);
  if (next.length === 0) recentlyClosedPanelTabs.delete(contextKey);
  else recentlyClosedPanelTabs.set(contextKey, next);
}

export function takeClosedPanelTab(
  contextKey: string,
  openTabIds: ReadonlySet<string>,
  canRestorePluginDetail: boolean,
): ClosedPanelTab | null {
  const stack = recentlyClosedPanelTabs.get(contextKey);
  if (stack === undefined) return null;
  while (stack.length > 0) {
    const entry = stack.at(-1);
    if (entry === undefined) break;
    if (entry.kind === "plugin-detail" && !canRestorePluginDetail) return null;
    stack.pop();
    if (openTabIds.has(closedTabId(entry))) continue;
    if (stack.length === 0) recentlyClosedPanelTabs.delete(contextKey);
    if (entry.orderIndex !== undefined) {
      const order = getPanelTabOrder(contextKey).filter(
        (id) => id !== closedTabId(entry),
      );
      order.splice(
        Math.min(entry.orderIndex, order.length),
        0,
        closedTabId(entry),
      );
      setPanelTabOrder(contextKey, order);
    }
    return entry;
  }
  recentlyClosedPanelTabs.delete(contextKey);
  return null;
}

export function resetRecentlyClosedPanelTabsForTest(): void {
  recentlyClosedPanelTabs.clear();
  panelTabOrders.clear();
}
