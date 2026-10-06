import { useEffect, useMemo, useRef } from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { destroyPersistedBrowserView } from "./browserViewVisibilityCoordinator";

interface BrowserTabLifecycleObserverProps {
  browserTabs: readonly BrowserFixedPanelTab[];
  threadId: string;
}

interface BrowserTabIdSnapshot {
  tabIds: ReadonlySet<string>;
  threadId: string;
}

interface BuildBrowserTabIdSetArgs {
  browserTabs: readonly BrowserFixedPanelTab[];
}

function buildBrowserTabIdSet({
  browserTabs,
}: BuildBrowserTabIdSetArgs): ReadonlySet<string> {
  return new Set(browserTabs.map((tab) => tab.id));
}

export function BrowserTabLifecycleObserver({
  browserTabs,
  threadId,
}: BrowserTabLifecycleObserverProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const previousTabIdsRef = useRef<BrowserTabIdSnapshot | null>(null);

  useEffect(() => {
    const tabIds = buildBrowserTabIdSet({ browserTabs });
    const previous = previousTabIdsRef.current;
    if (
      desktopBrowser !== null &&
      previous !== null &&
      previous.threadId === threadId
    ) {
      for (const tabId of previous.tabIds) {
        if (!tabIds.has(tabId)) {
          destroyPersistedBrowserView({ desktopBrowser, tabId });
        }
      }
    }
    previousTabIdsRef.current = { tabIds, threadId };
  }, [browserTabs, desktopBrowser, threadId]);

  return null;
}
