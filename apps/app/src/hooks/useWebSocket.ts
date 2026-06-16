import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createRealtimeCacheEffects } from "./realtime-cache-effects";
import { useDeletedResourceRouteOwner } from "./cache-owners/resource-route-owner";
import { wsManager } from "../lib/ws";

export { shouldFlushThreadChangesImmediately } from "./realtime-cache-effects";

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

    wsManager.connect();

    return () => {
      cacheEffects.dispose();
      unsubscribeConnected();
      unsubscribe();
    };
    // Route deletion handling is route-derived. Keep it behind a ref so
    // navigation cannot dispose cache effects and drop debounced invalidations.
  }, [queryClient]);
}
