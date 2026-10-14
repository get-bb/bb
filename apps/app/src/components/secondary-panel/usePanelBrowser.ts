import { useCallback, useEffect, useMemo, useState } from "react";
import type { BbDesktopBrowserApi } from "@bb/desktop-contract";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";
import {
  openUrlByPreference,
  useOpenLinksInAppBrowserPreference,
} from "@/lib/in-app-browser-link-preference";
import { isRoutePath } from "@/lib/route-paths";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import type { BrowserAddressFocusRequest } from "./BrowserTabContent";
import type { OpenSecondaryPanelTabRequest } from "./useThreadFileTabs";

interface UsePanelBrowserArgs {
  available: boolean;
  browserTabs: readonly { id: string }[];
  isFocused: boolean;
  openTab: (
    request: OpenSecondaryPanelTabRequest,
  ) => { id: string; kind: string } | null;
  reveal: () => void;
}

export interface PanelBrowser {
  addressFocusRequest: BrowserAddressFocusRequest | null;
  handleAddressFocusRequestConsumed: (
    request: BrowserAddressFocusRequest,
  ) => void;
  open: ((url?: string) => void) | null;
  openUrl: (url: string) => boolean;
}

export function subscribeDesktopOpenRequests(
  browserApi: Pick<BbDesktopBrowserApi, "onOpenTab" | "onScopedOpenTab"> | null,
  {
    browserTabIds,
    isFocused,
    openUrl,
  }: {
    browserTabIds: ReadonlySet<string>;
    isFocused: boolean;
    openUrl: (url: string) => void;
  },
): (() => void) | undefined {
  if (browserApi === null) return;
  if (browserApi.onScopedOpenTab) {
    return browserApi.onScopedOpenTab(({ tabId, url }) => {
      if (browserTabIds.has(tabId)) openUrl(url);
    });
  }
  if (!isFocused) return;
  return browserApi.onOpenTab(({ url }) => {
    if (!isRoutePath({ path: url })) openUrl(url);
  });
}

export function usePanelBrowser({
  available,
  browserTabs,
  isFocused,
  openTab,
  reveal,
}: UsePanelBrowserArgs): PanelBrowser {
  const [addressFocusRequest, setAddressFocusRequest] =
    useState<BrowserAddressFocusRequest | null>(null);
  const [openLinksInAppBrowser] = useOpenLinksInAppBrowserPreference();

  const openInAppBrowser = useCallback(
    (url = "") => {
      const tab = openTab({ kind: "browser", url });
      if (url.length === 0 && tab?.kind === "browser") {
        setAddressFocusRequest((current) => ({
          requestId: (current?.requestId ?? 0) + 1,
          tabId: tab.id,
        }));
      }
      reveal();
    },
    [openTab, reveal],
  );

  const openUrl = useCallback(
    (url: string) =>
      openUrlByPreference({
        desktopBrowserAvailable: available,
        openExternalBrowser: openUrlInExternalBrowser,
        openInAppBrowser,
        openLinksInAppBrowser,
        url,
      }),
    [available, openInAppBrowser, openLinksInAppBrowser],
  );

  const handleAddressFocusRequestConsumed = useCallback(
    (request: BrowserAddressFocusRequest) => {
      setAddressFocusRequest((current) =>
        current?.requestId === request.requestId &&
        current.tabId === request.tabId
          ? null
          : current,
      );
    },
    [],
  );

  const browserTabIds = useMemo(
    () => new Set(browserTabs.map((tab) => tab.id)),
    [browserTabs],
  );
  useEffect(
    () =>
      subscribeDesktopOpenRequests(getDesktopBrowserApi(), {
        browserTabIds,
        isFocused,
        openUrl,
      }),
    [browserTabIds, isFocused, openUrl],
  );

  return {
    addressFocusRequest,
    handleAddressFocusRequestConsumed,
    open: available ? openInAppBrowser : null,
    openUrl,
  };
}
