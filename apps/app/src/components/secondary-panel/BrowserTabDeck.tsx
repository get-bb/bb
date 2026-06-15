import { useEffect, useMemo, useRef } from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { BrowserTabContent } from "./BrowserTabContent";
import {
  createBrowserViewVisibilityCoordinator,
  destroyPersistedBrowserView,
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
 * Mounts only the active browser tab's content. Inactive persisted tabs remain
 * tab metadata until selected, so restoring a thread never eagerly creates and
 * loads a batch of hidden native `WebContentsView`s from stale persisted URLs.
 *
 * The native view manager keeps already-created views keyed by tab id, so
 * switching away unmounts the React content and hides the native view without
 * destroying the page. A tab's view is torn down when it leaves this thread's
 * open-tab list; thread navigation only unmounts this deck, so retained views
 * stay alive for when the user returns.
 *
 * When no browser tab is the active panel tab, React content unmounts but the
 * native views remain retained and hidden by their component cleanup.
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
  const visibilityCoordinator = useMemo(
    () =>
      desktopBrowser === null
        ? null
        : createBrowserViewVisibilityCoordinator(desktopBrowser),
    [desktopBrowser],
  );

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
  const activeBrowserTab =
    activeBrowserTabId === null
      ? null
      : (browserTabs.find((tab) => tab.id === activeBrowserTabId) ?? null);
  if (activeBrowserTab === null) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BrowserTabContent
        key={activeBrowserTab.id}
        tabId={activeBrowserTab.id}
        initialUrl={activeBrowserTab.url}
        isActive={isPanelOpen}
        visibilityCoordinator={visibilityCoordinator}
        environmentId={environmentId}
        threadId={threadId}
        onUpdate={onUpdate}
      />
    </div>
  );
}
