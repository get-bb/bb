import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";
import { useDeletedResourceRouteOwner } from "./cache-owners/resource-route-owner";
import { browserAutomationClient } from "../lib/browser-automation-client";
import { wsManager } from "../lib/ws";

export function useWebSocket(): void {
  const queryClient = useQueryClient();
  const handleDeletedResourceRouteChange = useDeletedResourceRouteOwner();
  const deletedResourceRouteChangeRef = useRef(
    handleDeletedResourceRouteChange,
  );
  deletedResourceRouteChangeRef.current = handleDeletedResourceRouteChange;

  useEffect(() => {
    const cacheEffects = createRealtimeCacheEffects({ queryClient });
    const unsubscribeConnected = wsManager.onConnected(
      cacheEffects.handleConnected,
    );
    const unsubscribe = wsManager.onChanged((message) => {
      cacheEffects.handleChanged(message);
      deletedResourceRouteChangeRef.current(message);
    });

    const stopBrowserAutomation = browserAutomationClient.start();
    wsManager.connect();

    return () => {
      stopBrowserAutomation();
      cacheEffects.dispose();
      unsubscribeConnected();
      unsubscribe();
    };
  }, [queryClient]);
}
