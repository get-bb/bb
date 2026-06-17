import type { ReactNode } from "react";
import {
  getBrowserHistoryStorageKey,
  type BrowserHistoryEntry,
} from "@/lib/browser-history";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { WithDesktopBrowser } from "../../../.ladle/story-desktop";
import { BrowserTabDeck } from "./BrowserTabDeck";

export default {
  title: "right-panel/Browser tab",
};

const noop = () => {};

const EMPTY_TAB_THREAD_ID = "thr_browser_tab_empty_story";
const RECENTS_TAB_THREAD_ID = "thr_browser_tab_recents_story";

// `url` is empty so the tab shows its in-tab new-tab screen rather than a live
// page — the native WebContentsView only exists in the packaged desktop app.
function makeBrowserTab(id: string): BrowserFixedPanelTab {
  return { environmentId: null, id, kind: "browser", title: null, url: "" };
}

const EMPTY_TAB = makeBrowserTab("browser:empty");
const RECENTS_TAB = makeBrowserTab("browser:recents");

const RECENT_VISITS: readonly BrowserHistoryEntry[] = [
  {
    url: "https://react.dev/reference/react/useLayoutEffect",
    title: "useLayoutEffect – React",
    visitedAt: Date.now() - 4 * 60 * 1000,
  },
  {
    url: "https://github.com/anthropics/anthropic-sdk-typescript",
    title: "anthropics/anthropic-sdk-typescript",
    visitedAt: Date.now() - 90 * 60 * 1000,
  },
  {
    url: "https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver",
    title: "ResizeObserver - Web APIs | MDN",
    visitedAt: Date.now() - 6 * 60 * 60 * 1000,
  },
  {
    url: "https://localhost:38886/",
    title: null,
    visitedAt: Date.now() - 26 * 60 * 60 * 1000,
  },
];

// Story-only: seed the per-thread browser history before the tab mounts so the
// new-tab screen's "Recently visited" list reads fixtures (atomWithStorage uses
// getOnInit). Mirrors the New tab story's recent-items seeding.
function seedBrowserHistory(
  threadId: string,
  entries: readonly BrowserHistoryEntry[],
): void {
  if (typeof window === "undefined") {
    return;
  }
  const storageKey = getBrowserHistoryStorageKey(threadId);
  if (entries.length === 0) {
    window.localStorage.removeItem(storageKey);
    return;
  }
  window.localStorage.setItem(storageKey, JSON.stringify(entries));
}

function PanelStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[520px] w-full max-w-[760px] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background">
      {children}
    </div>
  );
}

interface BrowserTabStageProps {
  tab: BrowserFixedPanelTab;
  threadId: string;
}

function BrowserTabStage({ tab, threadId }: BrowserTabStageProps) {
  return (
    <PanelStage>
      <BrowserTabDeck
        browserTabs={[tab]}
        activeBrowserTabId={tab.id}
        canShowNativeBrowserView
        threadId={threadId}
        environmentId={null}
        onUpdate={noop}
      />
    </PanelStage>
  );
}

export function Overview() {
  seedBrowserHistory(EMPTY_TAB_THREAD_ID, []);
  seedBrowserHistory(RECENTS_TAB_THREAD_ID, RECENT_VISITS);
  return (
    <WithDesktopBrowser>
      <StoryCard>
        <StoryRow
          label="new tab"
          hint="fresh browser tab — the toolbar address bar is the only input, above an empty start page"
        >
          <BrowserTabStage tab={EMPTY_TAB} threadId={EMPTY_TAB_THREAD_ID} />
        </StoryRow>
        <StoryRow
          label="recently visited"
          hint="start page with seeded per-thread history, styled like the New tab page rows"
        >
          <BrowserTabStage tab={RECENTS_TAB} threadId={RECENTS_TAB_THREAD_ID} />
        </StoryRow>
      </StoryCard>
    </WithDesktopBrowser>
  );
}
