import { useEffect, useRef } from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import type { BrowserAutomationClient } from "@/lib/browser-automation-client";
import type { OpenSecondaryPanelTabRequest } from "./useThreadFileTabs";

interface OpenedSecondaryPanelTab {
  id: string;
  kind: string;
}

interface UseBrowserAutomationThreadHostParams {
  browserTabs: readonly BrowserFixedPanelTab[];
  client: BrowserAutomationClient;
  closeTab: (tabId: string) => void;
  enabled: boolean;
  openTab: (
    request: OpenSecondaryPanelTabRequest,
  ) => OpenedSecondaryPanelTab | null;
  reveal: () => void;
  threadId: string;
}

export function useBrowserAutomationThreadHost({
  browserTabs,
  client,
  closeTab,
  enabled,
  openTab,
  reveal,
  threadId,
}: UseBrowserAutomationThreadHostParams): void {
  const openTabRef = useRef(openTab);
  const closeTabRef = useRef(closeTab);
  const revealRef = useRef(reveal);
  openTabRef.current = openTab;
  closeTabRef.current = closeTab;
  revealRef.current = reveal;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    return client.registerThreadHost(threadId, {
      openBrowserTab(url) {
        const tab = openTabRef.current({ kind: "browser", url });
        return tab !== null && tab.kind === "browser" ? tab.id : null;
      },
      closeBrowserTab(tabId) {
        closeTabRef.current(tabId);
      },
      reveal() {
        revealRef.current();
      },
    });
  }, [client, enabled, threadId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    client.reportBrowserTabs(
      threadId,
      new Set(browserTabs.map((tab) => tab.id)),
    );
  }, [browserTabs, client, enabled, threadId]);
}
