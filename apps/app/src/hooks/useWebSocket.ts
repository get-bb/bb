import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";
import { useDeletedResourceRouteOwner } from "./cache-owners/resource-route-owner";
import { createArchivedThreadBrowserOwner } from "./cache-owners/archived-thread-browser-owner";
import { wsManager } from "../lib/ws";
import { getDesktopBrowserApi } from "../lib/bb-desktop";
import { sdk } from "../lib/sdk";
import {
  applyThreadTimelineSignal,
  trackHeldThreadTimelineTags,
} from "./cache-owners/thread-timeline-push-owner";

export function useWebSocket(): void {
  const queryClient = useQueryClient();
  const handleDeletedResourceRouteChange = useDeletedResourceRouteOwner();
  const deletedResourceRouteChangeRef = useRef(
    handleDeletedResourceRouteChange,
  );
  deletedResourceRouteChangeRef.current = handleDeletedResourceRouteChange;

  useEffect(() => {
    const cacheEffects = createRealtimeCacheEffects({
      queryClient,
      refreshSidebarWhileHidden:
        window.bbDesktop?.setAttentionThreads !== undefined,
    });
    const handleArchivedThreadBrowsers = createArchivedThreadBrowserOwner({
      desktopBrowser: getDesktopBrowserApi(),
      readArchivedAt: async (threadId) =>
        (await sdk.threads.get({ threadId })).archivedAt,
    });
    const unsubscribeConnected = wsManager.onConnected(
      cacheEffects.handleConnected,
    );
    const unsubscribeArchivedThreadBrowsers = wsManager.onConnected(
      handleArchivedThreadBrowsers.handleConnected,
    );
    const unsubscribeResumed = wsManager.onResumed(cacheEffects.handleResumed);
    const releaseHeldThreadTimelineTags =
      trackHeldThreadTimelineTags(queryClient);
    const unsubscribeThreadTimeline = wsManager.onThreadTimeline((signal) => {
      applyThreadTimelineSignal(queryClient, signal);
    });
    const unsubscribe = wsManager.onChanged((message) => {
      cacheEffects.handleChanged(message);
      deletedResourceRouteChangeRef.current(message);
      handleArchivedThreadBrowsers.handleChanged(message);
    });

    wsManager.connect();

    return () => {
      cacheEffects.dispose();
      unsubscribeConnected();
      unsubscribeArchivedThreadBrowsers();
      unsubscribeResumed();
      releaseHeldThreadTimelineTags();
      unsubscribeThreadTimeline();
      unsubscribe();
    };
  }, [queryClient]);
}
