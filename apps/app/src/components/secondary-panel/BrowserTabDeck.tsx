import { useMemo, useRef } from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import { cn } from "@/lib/utils";
import { BrowserTabContent } from "./BrowserTabContent";
import {
  createBrowserViewVisibilityCoordinator,
  type BrowserViewVisibilityCoordinator,
} from "./browserViewVisibilityCoordinator";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";

export interface BrowserTabDeckProps {
  browserTabs: readonly BrowserFixedPanelTab[];
  activeBrowserTabId: string | null;
  /** Whether the secondary panel is open; gates the active view's visibility. */
  isPanelOpen: boolean;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
}

/**
 * Renders every open browser tab at once, keeping each tab's native
 * `WebContentsView` mounted (and its page + scroll intact) for the tab's whole
 * lifetime. Only the active tab is laid out and visible; the rest are
 * `display:none` with their views hidden — so switching tabs is a visibility
 * toggle, never a destroy/recreate + reload. A tab's view is torn down only when
 * its `BrowserTabContent` unmounts, i.e. when the tab is closed or the panel /
 * thread unmounts.
 *
 * Mounted regardless of which panel tab is active so the views survive switching
 * to a non-browser tab; the whole deck collapses to `display:none` when no
 * browser tab is active.
 */
export function BrowserTabDeck({
  browserTabs,
  activeBrowserTabId,
  isPanelOpen,
  threadId,
  onUpdate,
}: BrowserTabDeckProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  // One coordinator per deck owns the cross-tab visibility ordering for the
  // lifetime of the panel; created once (the native bridge identity is stable).
  const coordinatorRef = useRef<BrowserViewVisibilityCoordinator | null>(null);
  if (desktopBrowser !== null && coordinatorRef.current === null) {
    coordinatorRef.current =
      createBrowserViewVisibilityCoordinator(desktopBrowser);
  }
  const visibilityCoordinator = coordinatorRef.current;

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
              threadId={threadId}
              onUpdate={onUpdate}
            />
          </div>
        );
      })}
    </div>
  );
}
