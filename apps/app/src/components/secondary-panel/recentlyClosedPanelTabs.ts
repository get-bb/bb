import type { FixedPanelTab } from "@/lib/fixed-panel-tabs-state";

export interface ClosedPanelContentTab {
  kind: "content";
  index: number;
  tab: Exclude<
    FixedPanelTab,
    {
      kind:
        | "thread-info"
        | "git-diff"
        | "plugin-fixed"
        | "plugin-page-fixed"
        | "terminal";
    }
  >;
}

const recentlyClosedPanelTabs = new Map<string, ClosedPanelContentTab[]>();

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

export function rememberClosedPanelTab(
  contextKey: string,
  entry: ClosedPanelContentTab,
): void {
  const stack = recentlyClosedPanelTabs.get(contextKey) ?? [];
  stack.push(entry);
  if (stack.length > 25) stack.splice(0, stack.length - 25);
  recentlyClosedPanelTabs.set(contextKey, stack);
}

export function forgetClosedPanelTab(contextKey: string, tabId: string): void {
  const stack = recentlyClosedPanelTabs.get(contextKey);
  if (stack === undefined) return;
  const next = stack.filter((entry) => entry.tab.id !== tabId);
  if (next.length === 0) recentlyClosedPanelTabs.delete(contextKey);
  else recentlyClosedPanelTabs.set(contextKey, next);
}

export function takeClosedPanelTab(
  contextKey: string,
  openTabIds: ReadonlySet<string>,
): ClosedPanelContentTab | null {
  const stack = recentlyClosedPanelTabs.get(contextKey);
  if (stack === undefined) return null;
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    if (openTabIds.has(entry.tab.id)) continue;
    if (stack.length === 0) recentlyClosedPanelTabs.delete(contextKey);
    return entry;
  }
  recentlyClosedPanelTabs.delete(contextKey);
  return null;
}

export function resetRecentlyClosedPanelTabsForTest(): void {
  recentlyClosedPanelTabs.clear();
}
