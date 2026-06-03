import { useEffect, useMemo, useRef } from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { cn } from "@/lib/utils";
import { BrowserTabContent } from "./BrowserTabContent";
import {
  destroyPersistedBrowserView,
  getBrowserViewVisibilityCoordinator,
} from "./browserViewVisibilityCoordinator";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";

export interface BrowserTabDeckProps {
  browserTabs: readonly BrowserFixedPanelTab[];
  activeBrowserTabId: string | null;
  environmentId: string | null;
  /** Whether the secondary panel is open; gates the active view's visibility. */
  isPanelOpen: boolean;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
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

/**
 * Renders every open browser tab at once, keeping each tab's native
 * `WebContentsView` mounted (and its page + scroll intact) for the tab's whole
 * lifetime. Only the active tab is laid out and visible; the rest are
 * `display:none` with their views hidden — so switching tabs is a visibility
 * toggle, never a destroy/recreate + reload. A tab's view is torn down when it
 * leaves this thread's open-tab list; thread navigation only unmounts this deck,
 * so retained views stay alive for when the user returns.
 *
 * Mounted regardless of which panel tab is active so the views survive switching
 * to a non-browser tab; the whole deck collapses to `display:none` when no
 * browser tab is active.
 */
export function BrowserTabDeck({
  browserTabs,
  activeBrowserTabId,
  environmentId,
  isPanelOpen,
  threadId,
  onUpdate,
}: BrowserTabDeckProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const previousTabIdsRef = useRef<BrowserTabIdSnapshot | null>(null);
  const visibilityCoordinator =
    desktopBrowser === null
      ? null
      : getBrowserViewVisibilityCoordinator(desktopBrowser);

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

  if (browserTabs.length === 0) {
    return null;
  }
  const isBrowserTabActive = activeBrowserTabId !== null;
  return (
    <div
      className={cn(
        "min-h-0 flex-1",
        isBrowserTabActive ? "flex flex-col" : "hidden",
      )}
    >
      {browserTabs.map((tab) => {
        const isActive = tab.id === activeBrowserTabId;
        return (
          <div
            key={tab.id}
            className={cn(isActive ? "flex min-h-0 flex-1 flex-col" : "hidden")}
          >
            <BrowserTabContent
              tabId={tab.id}
              initialUrl={tab.url}
              isActive={isActive && isPanelOpen}
              visibilityCoordinator={visibilityCoordinator}
              environmentId={environmentId}
              threadId={threadId}
              onUpdate={onUpdate}
            />
          </div>
        );
      })}
    </div>
  );
}
