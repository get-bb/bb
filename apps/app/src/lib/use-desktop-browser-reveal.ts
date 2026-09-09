import { useEffect, useState } from "react";
import type { BbDesktopBrowserRevealRequest } from "@bb/desktop-contract";
import { getDesktopBrowserApi } from "./bb-desktop";

export function useDesktopBrowserReveal({
  threadId,
  isFocused,
  browserTabs,
  activateTab,
}: {
  threadId: string;
  isFocused: boolean;
  browserTabs: readonly { id: string }[];
  activateTab: (tabId: string) => void;
}) {
  const [pending, setPending] = useState<BbDesktopBrowserRevealRequest | null>(
    null,
  );

  useEffect(() => {
    if (!isFocused) return;
    const unsubscribe = getDesktopBrowserApi()?.onReveal?.((request) => {
      if (request.threadId === threadId) setPending(request);
    });
    return () => {
      unsubscribe?.();
      setPending(null);
    };
  }, [isFocused, threadId]);

  useEffect(() => {
    if (
      !isFocused ||
      pending === null ||
      pending.threadId !== threadId ||
      !browserTabs.some((tab) => tab.id === pending.tabId)
    )
      return;
    activateTab(pending.tabId);
    setPending(null);
  }, [isFocused, threadId, pending, browserTabs, activateTab]);
}
